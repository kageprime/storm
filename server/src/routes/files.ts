import { Hono } from 'hono'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getDb } from '../db/index.js'
import { authMiddleware, Variables } from '../auth/middleware.js'

const files = new Hono<{ Variables: Variables }>()

files.use('*', authMiddleware)

type FileNode = {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FileNode[]
}

function listTree(dir: string, basePath: string): FileNode[] {
  const entries: FileNode[] = []
  try {
    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name)
      const relPath = relative(basePath, fullPath).replace(/\\/g, '/')
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        if (name === '.git' || name === 'node_modules') continue
        const children = listTree(fullPath, basePath)
        if (children.length > 0 || false) {
          entries.push({ name, path: relPath, type: 'dir', children })
        }
      } else {
        entries.push({ name, path: relPath, type: 'file', size: stat.size })
      }
    }
  } catch {
    // directory doesn't exist
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.json',
  '.md', '.txt', '.xml', '.svg', '.yaml', '.yml', '.toml', '.ini',
  '.cfg', '.conf', '.sh', '.bat', '.ps1', '.env', '.gitignore',
  '.dockerfile', '.vue', '.svelte', '.py', '.rb', '.java', '.go',
  '.rs', '.cpp', '.c', '.h', '.hpp', '.sql', '.php',
])

const TEXT_FILENAMES = new Set([
  'dockerfile', 'makefile', 'gemfile', 'procfile',
])

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  const ext = lower.slice(lower.lastIndexOf('.'))
  if (TEXT_EXTENSIONS.has(ext)) return true
  if (TEXT_FILENAMES.has(lower)) return true
  return false
}

files.get('/:projectId/files', async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('projectId')

  const db = getDb()
  const result = db.exec(
    'SELECT sandbox_path FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  )

  const row = result[0]?.values?.[0]
  if (!row) {
    c.status(404)
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' })
  }

  const sandboxPath = row[0] as string
  const tree = listTree(sandboxPath, sandboxPath)

  return c.json({ files: tree })
})

files.get('/:projectId/files/:path{.+}', async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('projectId')
  const filePath = c.req.param('path')

  const db = getDb()
  const result = db.exec(
    'SELECT sandbox_path FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  )

  const row = result[0]?.values?.[0]
  if (!row) {
    c.status(404)
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' })
  }

  const sandboxPath = row[0] as string
  const fullPath = join(sandboxPath, filePath)

  try {
    const stat = statSync(fullPath)
    if (!stat.isFile()) {
      c.status(400)
      return c.json({ error: 'Not a file', code: 'BAD_REQUEST' })
    }

    const name = filePath.split('/').pop() || filePath
    const content = readFileSync(fullPath)

    if (isTextFile(name)) {
      c.header('Content-Type', 'text/plain; charset=utf-8')
      return c.body(content)
    }

    // Binary: return base64
    return c.json({
      name,
      type: 'binary',
      size: stat.size,
      data: content.toString('base64'),
    })
  } catch {
    c.status(404)
    return c.json({ error: 'File not found', code: 'NOT_FOUND' })
  }
})

export default files
