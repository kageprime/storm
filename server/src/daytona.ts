import { Daytona } from '@daytona/sdk'

export type DaytonaSandboxInfo = {
  sandboxId: string
  opencodeUrl: string
  projectDir: string
}

let daytonaClient: Daytona | null = null

function getClient(): Daytona {
  if (!daytonaClient) {
    daytonaClient = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
      apiUrl: process.env.DAYTONA_API_URL || undefined,
      target: process.env.DAYTONA_TARGET || undefined,
    })
  }
  return daytonaClient
}

const OPENCODE_PORT = 4096
const VITE_PORT = 3000
const PROJECT_DIR = '/home/daytona/project'

export function isDaytonaMode(): boolean {
  return !!process.env.DAYTONA_API_KEY
}

export async function createDaytonaSandbox(
  projectId: string,
  gitUrl: string | null,
): Promise<DaytonaSandboxInfo> {
  const client = getClient()

  const sandbox = await client.create({
    language: 'typescript',
    public: true,
    autoStopInterval: 60,
    autoDeleteInterval: 1440,
  })

  const sandboxId = sandbox.id

  try {
    // Set up project directory
    if (gitUrl) {
      await sandbox.git.clone(gitUrl, PROJECT_DIR)
    } else {
      await sandbox.fs.createFolder(PROJECT_DIR, '755')
    }

    // Ensure opencode CLI is available
    await sandbox.process.executeCommand(
      'npm install -g @opencode-ai/cli --no-fund --no-audit 2>/dev/null',
      undefined,
      undefined,
      120,
    )

    // Start opencode server in the background
    await sandbox.process.executeCommand(
      `cd ${PROJECT_DIR} && nohup npx opencode serve --port ${OPENCODE_PORT} --hostname 0.0.0.0 > /tmp/opencode.log 2>&1 &`,
    )

    // Wait for opencode server to be ready
    const opencodeReady = await waitForSandboxPort(sandbox, OPENCODE_PORT, 30_000)
    if (!opencodeReady) {
      throw new Error('OpenCode server failed to start in sandbox')
    }

    const preview = await sandbox.getPreviewLink(OPENCODE_PORT)
    const opencodeUrl = preview.url

    return { sandboxId, opencodeUrl, projectDir: PROJECT_DIR }
  } catch (err) {
    await sandbox.delete().catch(() => {})
    throw err
  }
}

export async function deleteDaytonaSandbox(sandboxId: string): Promise<void> {
  try {
    const client = getClient()
    const sandbox = await client.get(sandboxId)
    if (sandbox) {
      await sandbox.delete()
    }
  } catch {
    // already deleted or not found
  }
}

const devServerProcesses = new Map<string, string>()

export type DevServerResult = {
  url: string | null
  error?: string
}

export async function startDaytonaDevServer(
  sandboxId: string,
  projectId: string,
): Promise<DevServerResult> {
  try {
    const client = getClient()
    const sandbox = await client.get(sandboxId)

    // Check if Vite is already running
    const checkResult = await sandbox.process.executeCommand(
      `curl -s -o /dev/null -w "%{http_code}" http://localhost:${VITE_PORT}/ 2>/dev/null || echo "0"`,
    )
    if (checkResult.result.trim() === '200') {
      const preview = await sandbox.getPreviewLink(VITE_PORT)
      devServerProcesses.set(projectId, preview.url)
      return { url: preview.url }
    }

    // Check for package.json
    const pkgCheck = await sandbox.process.executeCommand(
      `test -f ${PROJECT_DIR}/package.json && echo "yes" || echo "no"`,
    )
    if (pkgCheck.result.trim() !== 'yes') {
      console.error(`[daytona] No package.json at ${PROJECT_DIR} for sandbox ${sandboxId}`)
      return { url: null, error: 'No package.json found in sandbox' }
    }

    // npm install if needed
    const nmCheck = await sandbox.process.executeCommand(
      `test -d ${PROJECT_DIR}/node_modules && echo "yes" || echo "no"`,
    )
    if (nmCheck.result.trim() !== 'yes') {
      console.log(`[daytona] Running npm install in sandbox ${sandboxId}...`)
      await sandbox.process.executeCommand(
        `cd ${PROJECT_DIR} && npm install --no-fund --no-audit 2>/dev/null`,
        undefined,
        undefined,
        120,
      )
    }

    // Start Vite dev server in background
    const hasVite = await sandbox.process.executeCommand(
      `test -f ${PROJECT_DIR}/vite.config.js -o -f ${PROJECT_DIR}/vite.config.ts && echo "yes" || echo "no"`,
    )
    if (hasVite.result.trim() === 'yes') {
      await sandbox.process.executeCommand(
        `cd ${PROJECT_DIR} && nohup npx vite --port ${VITE_PORT} --host 0.0.0.0 --open false > /tmp/vite.log 2>&1 &`,
      )
    } else {
      await sandbox.process.executeCommand(
        `cd ${PROJECT_DIR} && nohup npm run dev > /tmp/vite.log 2>&1 &`,
      )
    }

    // Wait for Vite to become reachable
    const viteReady = await waitForSandboxPort(sandbox, VITE_PORT, 30_000)
    if (!viteReady) {
      console.error(`[daytona] Vite did not start within 30s for sandbox ${sandboxId}`)
      return { url: null, error: 'Dev server did not start within 30s in sandbox' }
    }

    const preview = await sandbox.getPreviewLink(VITE_PORT)
    devServerProcesses.set(projectId, preview.url)
    return { url: preview.url }
  } catch (err) {
    console.error(`[daytona] Failed to start dev server for ${sandboxId}:`, err)
    return { url: null, error: err instanceof Error ? err.message : 'Unknown error starting dev server' }
  }
}

export function getDaytonaDevServerUrl(key: string): string | null {
  const s = devServerProcesses.get(key)
  return s !== undefined ? s : null
}

export function stopDaytonaDevServer(key: string): void {
  devServerProcesses.delete(key)
}

export function stopAllDaytonaDevServers(): void {
  devServerProcesses.clear()
}

async function waitForSandboxPort(
  sandbox: any,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const result = await sandbox.process.executeCommand(
        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/ 2>/dev/null || echo "0"`,
      )
      if (result.result.trim() === '200') return true
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

export async function listDaytonaFiles(
  sandboxId: string,
  dirPath: string,
): Promise<any[]> {
  const client = getClient()
  const sandbox = await client.get(sandboxId)
  const files = await sandbox.fs.listFiles(dirPath)
  return files
}

export async function readDaytonaFile(
  sandboxId: string,
  filePath: string,
): Promise<Buffer | null> {
  try {
    const client = getClient()
    const sandbox = await client.get(sandboxId)
    const content = await sandbox.fs.downloadFile(filePath)
    return Buffer.from(content)
  } catch {
    return null
  }
}

export async function writeDaytonaFile(
  sandboxId: string,
  filePath: string,
  content: string,
): Promise<void> {
  const client = getClient()
  const sandbox = await client.get(sandboxId)
  await sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), filePath)
}
