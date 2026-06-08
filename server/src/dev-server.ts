import { spawn, ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createConnection } from 'node:net'

interface DevServerInstance {
  proc: ChildProcess
  port: number
}

const servers = new Map<string, DevServerInstance>()
const SERVER_READY_TIMEOUT = 25000

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection(port, '127.0.0.1', () => {
      sock.end()
      resolve(true)
    })
    sock.on('error', () => resolve(false))
  })
}

export function stopDevServer(projectId: string) {
  const s = servers.get(projectId)
  if (!s) return
  s.proc.kill('SIGTERM')
  setTimeout(() => { if (!s.proc.killed) s.proc.kill('SIGKILL') }, 3000)
  servers.delete(projectId)
  console.log(`[dev-server] Stopped for ${projectId}`)
}

export function stopAllDevServers() {
  for (const id of [...servers.keys()]) stopDevServer(id)
}

export function getDevServerPort(projectId: string): number | null {
  const s = servers.get(projectId)
  return s && !s.proc.killed ? s.port : null
}

export async function ensureDevServer(projectId: string, sandboxPath: string): Promise<number | null> {
  const existingPort = getDevServerPort(projectId)
  if (existingPort) return existingPort

  const pkgPath = join(sandboxPath, 'package.json')
  if (!existsSync(pkgPath)) return null

  let pkg: Record<string, unknown>
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown> } catch { return null }
  const scripts = pkg.scripts as Record<string, string> | undefined
  if (!scripts || (!scripts.dev && !scripts.start)) return null

  console.log(`[dev-server] Starting for ${projectId}...`)

  if (!existsSync(join(sandboxPath, 'node_modules'))) {
    console.log(`[dev-server] Running npm install for ${projectId}...`)
    try {
      await new Promise<void>((resolve, reject) => {
        const inst = spawn('cmd.exe', ['/c', 'npm', 'install'], {
          cwd: sandboxPath, stdio: 'pipe', shell: true,
        })
        let err = ''
        inst.stderr?.on('data', (d) => { err += d.toString() })
        inst.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`npm install failed: ${err.slice(0, 300)}`)))
      })
      console.log(`[dev-server] npm install complete for ${projectId}`)
    } catch (e) {
      console.error(`[dev-server] npm install failed for ${projectId}:`, e)
      return null
    }
  }

  const port = 5000 + Math.floor(Math.random() * 2000)

  const proc = spawn('cmd.exe', ['/c', 'npm', 'run', 'dev'], {
    cwd: sandboxPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none' },
  })

  proc.stdout?.on('data', (d) => { /* ignore — could log for debugging */ })
  proc.stderr?.on('data', (d) => { /* ignore */ })
  proc.on('exit', () => { servers.delete(projectId) })

  servers.set(projectId, { proc, port })

  const deadline = Date.now() + SERVER_READY_TIMEOUT
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600))
    if (await checkPort(port)) {
      console.log(`[dev-server] Ready for ${projectId} on port ${port}`)
      return port
    }
  }

  console.error(`[dev-server] Timeout for ${projectId}`)
  stopDevServer(projectId)
  return null
}
