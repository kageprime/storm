import { Hono } from 'hono'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { getDb, saveDb } from '../db/index.js'
import { authMiddleware, Variables } from '../auth/middleware.js'
import { isDaytonaMode, listDaytonaFiles, readDaytonaFile } from '../daytona.js'

const SANDBOX_ROOT = process.env.SANDBOX_ROOT || join(process.cwd(), 'sandboxes')

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
    'SELECT sandbox_path, daytona_sandbox_id FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  )

  const row = result[0]?.values?.[0]
  if (!row) {
    c.status(404)
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' })
  }

  const sandboxPath = row[0] as string | null
  const daytonaSandboxId = row[1] as string | null

  if (daytonaSandboxId && isDaytonaMode()) {
    try {
      const daytonaFiles = await listDaytonaFiles(daytonaSandboxId, '/home/daytona/project')
      const tree = daytonaFilesToTree(daytonaFiles, '/home/daytona/project')
      return c.json({ files: tree })
    } catch (err) {
      console.error('[files] Daytona list failed:', err)
      return c.json({ files: [] })
    }
  }

  // Lazy-create local sandbox if missing (e.g., project created in Daytona mode
  // but server now running without DAYTONA_API_KEY)
  const localPath = sandboxPath || join(SANDBOX_ROOT, projectId)
  try {
    await mkdir(localPath, { recursive: true })
  } catch {
    return c.json({ files: [] })
  }
  if (!sandboxPath) {
    db.run('UPDATE projects SET sandbox_path = ? WHERE id = ?', [localPath, projectId])
    saveDb()
  }

  const tree = listTree(localPath, localPath)
  return c.json({ files: tree })
})

files.get('/:projectId/files/:path{.+}', async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('projectId')
  const filePath = c.req.param('path')

  const db = getDb()
  const result = db.exec(
    'SELECT sandbox_path, daytona_sandbox_id FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  )

  const row = result[0]?.values?.[0]
  if (!row) {
    c.status(404)
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' })
  }

  const sandboxPath = row[0] as string | null
  const daytonaSandboxId = row[1] as string | null

  if (daytonaSandboxId && isDaytonaMode()) {
    try {
      const fullDaytonaPath = `/home/daytona/project/${filePath}`
      const buf = await readDaytonaFile(daytonaSandboxId, fullDaytonaPath)
      if (!buf) {
        c.status(404)
        return c.json({ error: 'File not found', code: 'NOT_FOUND' })
      }
      const name = filePath.split('/').pop() || filePath
      if (isTextFile(name)) {
        c.header('Content-Type', 'text/plain; charset=utf-8')
        return c.body(new Uint8Array(buf))
      }
      return c.json({
        name,
        type: 'binary',
        size: buf.length,
        data: buf.toString('base64'),
      })
    } catch {
      c.status(404)
      return c.json({ error: 'File not found', code: 'NOT_FOUND' })
    }
  }

  const localPath = sandboxPath || join(SANDBOX_ROOT, projectId)
  if (!sandboxPath) {
    try {
      await mkdir(localPath, { recursive: true })
    } catch {
      c.status(404)
      return c.json({ error: 'Project not found', code: 'NOT_FOUND' })
    }
    db.run('UPDATE projects SET sandbox_path = ? WHERE id = ?', [localPath, projectId])
    saveDb()
  }

  const fullPath = join(localPath, filePath)

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
      return c.newResponse(new Uint8Array(content))
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

function daytonaFilesToTree(files: any[], basePath: string): FileNode[] {
  const map = new Map<string, FileNode>()

  for (const f of files) {
    const fullPath = f.name
    const relPath = fullPath.startsWith(basePath) ? fullPath.slice(basePath.length).replace(/^\//, '') : fullPath
    const parts = relPath.split('/').filter(Boolean)
    let current = ''
    for (let i = 0; i < parts.length; i++) {
      const parent = current
      current = current ? `${current}/${parts[i]}` : parts[i]
      if (!map.has(current)) {
        const isDir = i < parts.length - 1 || f.isDir
        map.set(current, {
          name: parts[i],
          path: current,
          type: isDir ? 'dir' : 'file',
          size: f.size,
          children: isDir ? [] : undefined,
        })
      } else if (i === parts.length - 1 && !f.isDir) {
        const existing = map.get(current)!
        existing.type = 'file'
        existing.size = f.size
        existing.children = undefined
      }
    }
  }

  const root: FileNode[] = []
  for (const [path, node] of map) {
    if (!path.includes('/')) {
      root.push(node)
    } else {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      const parent = map.get(parentPath)
      if (parent && parent.children) {
        parent.children.push(node)
      }
    }
  }

  root.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const node of map.values()) {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    }
  }

  return root
}

export default files
