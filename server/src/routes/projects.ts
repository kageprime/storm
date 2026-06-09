import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { getDb, saveDb } from '../db/index.js'
import { authMiddleware, Variables } from '../auth/middleware.js'
import { createSandbox, deleteSandbox, getProjectSandboxInfo, scanSandboxDirectories } from '../sandbox.js'

const projects = new Hono<{ Variables: Variables }>()

projects.use('*', authMiddleware)

projects.get('/', async (c) => {
  const { userId } = c.get('user')

  scanSandboxDirectories(userId)

  const db = getDb()
  const result = db.exec(
    'SELECT id, name, git_url, status, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  )

  const rows = result[0]?.values || []
  const list = rows.map((row) => {
    const [id, name, gitUrl, status, createdAt, updatedAt] = row as [string, string, string | null, string, string, string]
    return { id, name, gitUrl, status, createdAt, updatedAt }
  })

  return c.json({ projects: list })
})

projects.post('/', async (c) => {
  const { userId } = c.get('user')
  const { name, gitUrl } = await c.req.json()

  if (!name) {
    c.status(400)
    return c.json({ error: 'Project name is required', code: 'VALIDATION_ERROR' })
  }

  const db = getDb()
  const projectId = uuid()

  const sandboxInfo = await createSandbox(projectId, gitUrl || null)
  const status = gitUrl ? 'cloning' : 'ready'

  db.run(
    'INSERT INTO projects (id, user_id, name, git_url, status, sandbox_path, daytona_sandbox_id, daytona_opencode_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [projectId, userId, name, gitUrl || null, status, sandboxInfo.sandboxPath, sandboxInfo.daytonaSandboxId, sandboxInfo.daytonaOpencodeUrl]
  )
  saveDb()

  c.status(201)
  return c.json({
    project: {
      id: projectId,
      name,
      gitUrl: gitUrl || null,
      status,
      sandboxPath: sandboxInfo.sandboxPath,
      daytonaSandboxId: sandboxInfo.daytonaSandboxId,
      daytonaOpencodeUrl: sandboxInfo.daytonaOpencodeUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  })
})

projects.get('/:id', async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('id')

  const db = getDb()
  const result = db.exec(
    'SELECT id, name, git_url, status, sandbox_path, daytona_sandbox_id, daytona_opencode_url, created_at, updated_at FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  )

  const rows = result[0]?.values
  if (!rows?.length) {
    c.status(404)
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' })
  }

  const [id, name, gitUrl, status, sandboxPath, daytonaSandboxId, daytonaOpencodeUrl, createdAt, updatedAt] = rows[0] as [string, string, string | null, string, string | null, string | null, string | null, string, string]

  return c.json({ project: { id, name, gitUrl, status, sandboxPath, daytonaSandboxId, daytonaOpencodeUrl, createdAt, updatedAt } })
})

projects.delete('/:id', async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('id')

  const db = getDb()

  const result = db.exec(
    'SELECT sandbox_path, daytona_sandbox_id, daytona_opencode_url FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  )

  const rows = result[0]?.values
  if (!rows?.length) {
    c.status(404)
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' })
  }

  const [sandboxPath, daytonaSandboxId, daytonaOpencodeUrl] = rows[0] as [string | null, string | null, string | null]

  db.run('DELETE FROM projects WHERE id = ?', [projectId])
  saveDb()

  await deleteSandbox({ sandboxPath, daytonaSandboxId, daytonaOpencodeUrl })

  return c.json({ success: true })
})

export default projects
