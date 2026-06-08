import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { initDb, closeDb, getDb } from './db/index.js'
import authRoutes from './auth/routes.js'
import projectsRoutes from './routes/projects.js'
import goalsRoutes from './routes/goals.js'
import filesRoutes from './routes/files.js'
import { ensureDevServer, getDevServerPort, stopDevServer, stopAllDevServers } from './dev-server.js'
import { authMiddleware, Variables } from './auth/middleware.js'

const app = new Hono()

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }, 500)
})

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

app.get('/api/health', (c) => c.json({ healthy: true, version: '0.1.0' }))

app.route('/api/auth', authRoutes)
app.route('/api/projects', projectsRoutes)
app.route('/api/projects', goalsRoutes)
app.route('/api/projects', filesRoutes)

// ─── Preview route (no auth, public via UUID) ───

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json',
}

function lookupSandbox(projectId: string): string | null {
  try {
    const db = getDb()
    const result = db.exec('SELECT sandbox_path FROM projects WHERE id = ?', [projectId])
    const row = result[0]?.values?.[0]
    return row ? (row[0] as string) : null
  } catch {
    return null
  }
}

function rewriteHtmlPaths(html: string, proxyPrefix: string): string {
  return html
    .replace(/(src|href|srcset)="\/(?!\/)/g, `$1="${proxyPrefix}/`)
    .replace(/url\(\s*['"]?\/(?!\/)/g, `url(${proxyPrefix}/`)
}

async function serveViaProxy(c: any, projectId: string, upstreamPath: string): Promise<Response | null> {
  const port = getDevServerPort(projectId)
  if (!port) return null
  try {
    const query = c.req.url.includes('?') ? c.req.url.slice(c.req.url.indexOf('?')) : ''
    const url = `http://127.0.0.1:${port}${upstreamPath}${query}`
    const headers = new Headers()
    for (const [k, v] of Object.entries(c.req.raw.headers)) {
      if (!['host', 'connection', 'keep-alive', 'transfer-encoding'].includes(k)) {
        if (Array.isArray(v)) v.forEach((x: string) => headers.append(k, x))
        else headers.set(k, v as string)
      }
    }
    const resp = await fetch(url, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.blob(),
    })
    const ct = resp.headers.get('content-type') || ''
    if (resp.ok && ct.includes('text/html')) {
      const html = await resp.text()
      const prefix = `/api/preview/${projectId}`
      const out = new TextEncoder().encode(rewriteHtmlPaths(html, prefix))
      const outHeaders = new Headers(resp.headers)
      outHeaders.set('content-length', String(out.byteLength))
      return new Response(out, { status: resp.status, headers: outHeaders })
    }
    return new Response(resp.body, { status: resp.status, headers: resp.headers })
  } catch {
    return null
  }
}

async function serveStatic(c: any, projectId: string, filePath?: string): Promise<Response> {
  const sandboxPath = lookupSandbox(projectId)
  if (!sandboxPath) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404)
  }

  if (filePath) {
    const fullPath = join(sandboxPath, filePath)
    if (!fullPath.startsWith(sandboxPath)) {
      return c.json({ error: 'Access denied', code: 'FORBIDDEN' }, 403)
    }
    try {
      const s = statSync(fullPath)
      if (!s.isFile()) {
        const indexPath = join(fullPath, 'index.html')
        try { statSync(indexPath); return serveStatic(c, projectId, join(filePath, 'index.html')) }
        catch { return c.json({ error: 'Not a file', code: 'BAD_REQUEST' }, 400) }
      }
      const ext = extname(filePath).toLowerCase()
      c.header('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
      c.header('Cache-Control', 'no-cache')
      return c.body(readFileSync(fullPath))
    } catch {
      return c.json({ error: 'File not found', code: 'NOT_FOUND' }, 404)
    }
  }

  // No file path — try index.html
  for (const name of ['index.html', 'index.htm']) {
    const fp = join(sandboxPath, name)
    try { statSync(fp); return serveStatic(c, projectId, name) } catch {}
  }
  return c.json({ error: 'No index.html found', code: 'NOT_FOUND' }, 404)
}

const previewRouter = new Hono()

previewRouter.get('/preview/:projectId/:path{.+}', async (c) => {
  const projectId = c.req.param('projectId')
  const filePath = c.req.param('path')

  const proxyResp = await serveViaProxy(c, projectId, '/' + filePath)
  if (proxyResp) return proxyResp

  return serveStatic(c, projectId, filePath)
})

previewRouter.get('/preview/:projectId/', async (c) => {
  return c.redirect(c.req.path.slice(0, -1), 301)
})

previewRouter.get('/preview/:projectId', async (c) => {
  const projectId = c.req.param('projectId')

  // Try proxy first (dev server already running)
  const proxyResp = await serveViaProxy(c, projectId, '/')
  if (proxyResp) return proxyResp

  // No dev server yet — try to start one and wait
  const sandboxPath = lookupSandbox(projectId)
  if (sandboxPath) {
    const port = await ensureDevServer(projectId, sandboxPath)
    if (port) {
      const retry = await serveViaProxy(c, projectId, '/')
      if (retry) return retry
    }
  }

  return serveStatic(c, projectId)
})

// Dev server management endpoints (requires auth)
const devRouter = new Hono<{ Variables: Variables }>()
devRouter.post('/dev-server/:projectId/start', authMiddleware, async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('projectId')!
  const check = getDb().exec('SELECT sandbox_path FROM projects WHERE id = ? AND user_id = ?', [projectId, userId])
  const row = check[0]?.values?.[0]
  if (!row) return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404)
  const port = await ensureDevServer(projectId, row[0] as string)
  if (!port) return c.json({ error: 'No dev server available', code: 'NO_DEV_SERVER' }, 400)
  return c.json({ url: `/api/preview/${projectId}/`, port })
})
devRouter.post('/dev-server/:projectId/stop', authMiddleware, async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('projectId')!
  const check = getDb().exec('SELECT id FROM projects WHERE id = ? AND user_id = ?', [projectId, userId])
  if (!check[0]?.values?.[0]) return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404)
  stopDevServer(projectId)
  return c.json({ success: true })
})
app.route('/api', devRouter)

app.route('/api', previewRouter)

// ─── Start ───

const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '0.0.0.0'

async function main() {
  await initDb()
  console.log(`Database initialized`)

  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
  })

  console.log(`Storm server running at http://${HOST}:${PORT}`)
}

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  stopAllDevServers()
  closeDb()
  process.exit(0)
})

process.on('SIGTERM', () => {
  stopAllDevServers()
  closeDb()
  process.exit(0)
})

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
