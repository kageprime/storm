import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { initDb, closeDb } from './db/index.js'
import authRoutes from './auth/routes.js'
import projectsRoutes from './routes/projects.js'
import goalsRoutes from './routes/goals.js'

const app = new Hono()

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

app.get('/api/health', (c) => c.json({ healthy: true, version: '0.1.0' }))

app.route('/api/auth', authRoutes)
app.route('/api/projects', projectsRoutes)
app.route('/api/projects', goalsRoutes)

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
  closeDb()
  process.exit(0)
})

process.on('SIGTERM', () => {
  closeDb()
  process.exit(0)
})

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
