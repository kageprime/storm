import { spawn, ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createConnection } from 'node:net'

interface DevServerInstance {
  proc: ChildProcess
  port: number
}

const servers = new Map<string, DevServerInstance>()
const PORT_TIMEOUT = 30000

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection(port, '127.0.0.1', () => {
      sock.end()
      resolve(true)
    })
    sock.on('error', () => resolve(false))
  })
}

async function scanPorts(ports: number[]): Promise<number | null> {
  const deadline = Date.now() + PORT_TIMEOUT
  while (Date.now() < deadline) {
    for (const p of ports) {
      if (await checkPort(p)) return p
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  return null
}

function log(projectId: string, msg: string) {
  console.log(`[dev-server] [${projectId.slice(0, 8)}] ${msg}`)
}

function logErr(projectId: string, msg: string) {
  console.error(`[dev-server] [${projectId.slice(0, 8)}] ${msg}`)
}

export function stopDevServer(projectId: string) {
  const s = servers.get(projectId)
  if (!s) return
  s.proc.kill('SIGTERM')
  setTimeout(() => { if (!s.proc.killed) s.proc.kill('SIGKILL') }, 3000)
  servers.delete(projectId)
  log(projectId, 'Stopped')
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

  // Kill any leftover vite/node processes from previous runs in this sandbox
  for (const [id, s] of servers) {
    if (s.proc.killed) servers.delete(id)
  }

  const pkgPath = join(sandboxPath, 'package.json')
  if (!existsSync(pkgPath)) return null

  let pkg: Record<string, unknown>
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown> } catch { return null }
  const scripts = pkg.scripts as Record<string, string> | undefined
  const hasVite = existsSync(join(sandboxPath, 'vite.config.js')) || existsSync(join(sandboxPath, 'vite.config.ts'))
  const devCmd = scripts?.dev || scripts?.start
  if (!devCmd && !hasVite) return null

  log(projectId, 'Starting...')

  // npm install if needed
  if (!existsSync(join(sandboxPath, 'node_modules'))) {
    log(projectId, 'Running npm install...')
    try {
      await new Promise<void>((resolve, reject) => {
        const inst = spawn('cmd.exe', ['/c', 'npm', 'install', '--no-fund', '--no-audit'], {
          cwd: sandboxPath, stdio: 'pipe', shell: true,
        })
        let out = ''
        inst.stdout?.on('data', (d) => { out += d.toString() })
        inst.stderr?.on('data', (d) => { out += d.toString() })
        inst.on('exit', (code) => code === 0 ? resolve() : reject(new Error(out.slice(0, 500))))
      })
      log(projectId, 'npm install complete')
    } catch (e) {
      logErr(projectId, `npm install failed: ${e}`)
      return null
    }
  }

  // Build the command: prefer running vite directly to bypass npm scripts
  const logPath = join(sandboxPath, 'dev-server.log')
  const stderrStream = (data: Buffer) => {
    const msg = data.toString()
    appendFileSync(logPath, msg)
  }

  // Probe ports: try a specific port, then fall back to common ones
  const preferredPort = 5000 + Math.floor(Math.random() * 2000)
  const candidatePorts = [preferredPort, 5173, 4173, 3000, 8080]

  let proc: ChildProcess

  if (hasVite) {
    // Direct vite — most reliable for Vite projects
    proc = spawn('cmd.exe', [
      '/c', 'npx', 'vite', '--port', String(preferredPort),
      '--host', '127.0.0.1', '--open', 'false', '--strictPort', 'false',
    ], {
      cwd: sandboxPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none', PORT: String(preferredPort) },
    })
  } else {
    // Generic npm run dev / start with PORT env
    proc = spawn('cmd.exe', ['/c', 'npm', 'run', 'dev'], {
      cwd: sandboxPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(preferredPort), HOST: '127.0.0.1', BROWSER: 'none' },
    })
  }

  let detectedPort: number | null = null
  let stdoutBuf = ''

  proc.stdout?.on('data', (d: Buffer) => {
    const text = d.toString()
    stdoutBuf += text
    // Try to extract port from Vite output: "Local:   http://localhost:PORT/"
    const m = text.match(/localhost[:\s](\d{4,5})/)
    if (m && !detectedPort) {
      detectedPort = parseInt(m[1], 10)
    }
  })
  proc.stderr?.on('data', stderrStream)

  proc.on('exit', (code) => {
    servers.delete(projectId)
    if (code !== 0 && code !== null) {
      logErr(projectId, `Exited with code ${code}`)
    }
  })

  servers.set(projectId, { proc, port: 0 }) // placeholder port

  // Wait for the server to become reachable
  const deadline = Date.now() + PORT_TIMEOUT
  let connectedPort: number | null = null

  while (Date.now() < deadline) {
    // If Vite printed a port to stdout, use it
    if (detectedPort) {
      if (await checkPort(detectedPort)) {
        connectedPort = detectedPort
        break
      }
    }
    // Also check the preferred port and other candidates
    for (const p of [preferredPort, 5173, 4173]) {
      if (p === detectedPort) continue // already checked
      if (await checkPort(p)) {
        connectedPort = p
        break
      }
    }
    if (connectedPort) break
    await new Promise((r) => setTimeout(r, 600))
  }

  if (!connectedPort) {
    logErr(projectId, `Timeout — no port detected. Stdout snippet: ${stdoutBuf.slice(0, 300)}`)
    stopDevServer(projectId)
    return null
  }

  servers.set(projectId, { proc, port: connectedPort })
  log(projectId, `Ready on port ${connectedPort}`)
  return connectedPort
}
