import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { initDb, closeDb, getDb } from './db/index.js'
import authRoutes from './auth/routes.js'
import projectsRoutes from './routes/projects.js'
import goalsRoutes from './routes/goals.js'
import filesRoutes from './routes/files.js'
import { ensureDevServer, getDevServerPort, stopDevServer, stopAllDevServers } from './dev-server.js'
import { authMiddleware, Variables } from './auth/middleware.js'
import { isDaytonaMode, startDaytonaDevServer, getDaytonaDevServerUrl, stopDaytonaDevServer } from './daytona.js'

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
    .replace(/(src|href|srcset)='\/(?!\/)/g, `$1='${proxyPrefix}/`)
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
    const candidates = [
      join(sandboxPath, filePath),
      join(sandboxPath, 'dist', filePath),
    ]
    for (const fullPath of candidates) {
      if (!fullPath.startsWith(sandboxPath)) continue
      try {
        const s = statSync(fullPath)
        if (!s.isFile()) {
          const indexPath = join(fullPath, 'index.html')
          try { statSync(indexPath); return serveStatic(c, projectId, join(filePath, 'index.html')) }
          catch { break }
        }
        const ext = extname(filePath).toLowerCase()
        c.header('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
        c.header('Cache-Control', 'no-cache')
        return c.body(new Uint8Array(readFileSync(fullPath)))
      } catch {}
    }
    return c.json({ error: 'File not found', code: 'NOT_FOUND' }, 404)
  }

  // No file path — prefer dist/index.html (built Vite) over root index.html (source)
  const distBase = join(sandboxPath, 'dist')
  const hasDist = existsSync(distBase) && statSync(distBase).isDirectory()
  const bases = hasDist ? [distBase, sandboxPath] : [sandboxPath]
  for (const base of bases) {
    for (const name of ['index.html', 'index.htm']) {
      const fp = join(base, name)
      try { statSync(fp); return serveStatic(c, projectId, join(base, name).slice(sandboxPath.length + 1)) } catch {}
    }
  }
  return c.json({ error: 'No index.html found', code: 'NOT_FOUND' }, 404)
}

async function serveViaDaytonaProxy(c: any, projectId: string, upstreamPath: string): Promise<Response | null> {
  const baseUrl = getDaytonaDevServerUrl(projectId)
  if (!baseUrl) return null
  try {
    const query = c.req.url.includes('?') ? c.req.url.slice(c.req.url.indexOf('?')) : ''
    const url = `${baseUrl}${upstreamPath}${query}`
    const resp = await fetch(url, {
      method: c.req.method,
      headers: { 'X-Daytona-Skip-Preview-Warning': 'true' },
    })
    const outHeaders = new Headers(resp.headers)
    outHeaders.delete('content-security-policy')
    outHeaders.delete('x-frame-options')
    const ct = resp.headers.get('content-type') || ''
    if (resp.ok && ct.includes('text/html')) {
      const html = await resp.text()
      const prefix = `/api/preview/${projectId}`
      const out = new TextEncoder().encode(rewriteHtmlPaths(html, prefix))
      outHeaders.set('content-length', String(out.byteLength))
      return new Response(out, { status: resp.status, headers: outHeaders })
    }
    return new Response(resp.body, { status: resp.status, headers: outHeaders })
  } catch {
    return null
  }
}

async function ensureDaytonaDevServer(projectId: string): Promise<string | null> {
  const db = getDb()
  const result = db.exec(
    'SELECT daytona_sandbox_id FROM projects WHERE id = ?',
    [projectId]
  )
  const daytonaSandboxId = result[0]?.values?.[0]?.[0] as string | undefined
  if (!daytonaSandboxId) return null
  const res = await startDaytonaDevServer(daytonaSandboxId, projectId)
  return res.url
}

async function serveDaytonaStatic(c: any, projectId: string): Promise<Response | null> {
  const db = getDb()
  const result = db.exec(
    'SELECT daytona_sandbox_id FROM projects WHERE id = ?',
    [projectId]
  )
  const daytonaSandboxId = result[0]?.values?.[0]?.[0] as string | undefined
  if (!daytonaSandboxId) return null
  const { readDaytonaFile } = await import('./daytona.js')
  const candidates = [
    '/home/daytona/project/dist/index.html',
    '/home/daytona/project/index.html',
    '/home/daytona/project/index.htm',
  ]
  for (const path of candidates) {
    const buf = await readDaytonaFile(daytonaSandboxId, path)
    if (buf) {
      c.header('Content-Type', 'text/html; charset=utf-8')
      c.header('Cache-Control', 'no-cache')
      const prefix = `/api/preview/${projectId}`
      const html = new TextDecoder().decode(buf)
      const rewritten = rewriteHtmlPaths(html, prefix)
      return c.body(new Uint8Array(new TextEncoder().encode(rewritten)))
    }
  }
  return null
}

const previewRouter = new Hono()

previewRouter.get('/preview/:projectId/:path{.+}', async (c) => {
  const projectId = c.req.param('projectId')
  const filePath = c.req.param('path')

  if (isDaytonaMode()) {
    const proxyResp = await serveViaDaytonaProxy(c, projectId, '/' + filePath)
    if (proxyResp) return proxyResp
    // Fallback: serve file from Daytona FS
    const db = getDb()
    const result = db.exec('SELECT daytona_sandbox_id FROM projects WHERE id = ?', [projectId])
    const daytonaSandboxId = result[0]?.values?.[0]?.[0] as string | undefined
    if (daytonaSandboxId) {
      const { readDaytonaFile } = await import('./daytona.js')
      const buf = await readDaytonaFile(daytonaSandboxId, `/home/daytona/project/${filePath}`)
      if (buf) {
        const ext = extname(filePath).toLowerCase()
        c.header('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
        c.header('Cache-Control', 'no-cache')
        return c.body(new Uint8Array(buf))
      }
    }
  }

  const proxyResp = await serveViaProxy(c, projectId, '/' + filePath)
  if (proxyResp) return proxyResp

  return serveStatic(c, projectId, filePath)
})

previewRouter.on('HEAD', '/preview/:projectId/', async (c) => {
  return c.redirect(c.req.path.slice(0, -1), 308)
})

previewRouter.get('/preview/:projectId/', async (c) => {
  return c.redirect(c.req.path.slice(0, -1), 301)
})

previewRouter.get('/preview/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const isHead = c.req.method === 'HEAD'

  // Fast HEAD: project exists in DB -> 200
  if (isHead) {
    const sp = lookupSandbox(projectId)
    if (sp) {
      for (const base of [join(sp, 'dist'), sp]) {
        for (const name of ['index.html', 'index.htm']) {
          try { statSync(join(base, name)); return c.newResponse(null, 200) } catch {}
        }
      }
    }
    const db = getDb()
    const exists = db.exec('SELECT id FROM projects WHERE id = ?', [projectId])
    if (exists[0]?.values?.[0]) return c.newResponse(null, 200)
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404)
  }

  if (isDaytonaMode()) {
    let daytonaUrl = getDaytonaDevServerUrl(projectId)
    if (!daytonaUrl) {
      daytonaUrl = await ensureDaytonaDevServer(projectId)
    }
    if (daytonaUrl) {
      const proxyResp = await serveViaDaytonaProxy(c, projectId, '/')
      if (proxyResp) return proxyResp
    }
    // Fallback: serve files directly from Daytona sandbox FS
    const staticResp = await serveDaytonaStatic(c, projectId)
    if (staticResp) return staticResp
    return c.json({ error: 'No index.html found', code: 'NOT_FOUND' }, 404)
  }

  const proxyResp = await serveViaProxy(c, projectId, '/')
  if (proxyResp) return proxyResp

  const sandboxPath = lookupSandbox(projectId)
  if (sandboxPath) {
    const result = await ensureDevServer(projectId, sandboxPath)
    if (result.url) {
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
  const db = getDb()
  const check = db.exec(
    'SELECT sandbox_path, daytona_sandbox_id FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  )
  const row = check[0]?.values?.[0]
  if (!row) return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404)

  const sandboxPath = row[0] as string | null
  const daytonaSandboxId = row[1] as string | null

  const result = await ensureDevServer(projectId, sandboxPath || '', daytonaSandboxId)
  if (!result.url) return c.json({ error: result.error || 'No dev server available', code: 'NO_DEV_SERVER' }, 400)

  return c.json({ url: result.url, port: isDaytonaMode() ? null : parseInt(result.url.split(':').pop() || '0', 10) })
})
devRouter.post('/dev-server/:projectId/stop', authMiddleware, async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('projectId')!
  const check = getDb().exec('SELECT id FROM projects WHERE id = ? AND user_id = ?', [projectId, userId])
  if (!check[0]?.values?.[0]) return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404)

  if (isDaytonaMode()) {
    stopDaytonaDevServer(projectId)
  } else {
    stopDevServer(projectId)
  }
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
