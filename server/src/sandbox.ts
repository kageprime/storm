import { mkdir, rm, access, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { v4 as uuid } from 'uuid'
import { isDaytonaMode, createDaytonaSandbox, deleteDaytonaSandbox, writeDaytonaFile, readDaytonaFile, type DaytonaSandboxInfo } from './daytona.js'
import { getDb, saveDb } from './db/index.js'

const SANDBOX_ROOT = process.env.SANDBOX_ROOT || join(process.cwd(), 'sandboxes')

export type SandboxInfo = {
  sandboxPath: string | null
  daytonaSandboxId: string | null
  daytonaOpencodeUrl: string | null
}

export async function createSandbox(projectId: string, gitUrl: string | null): Promise<SandboxInfo> {
  if (isDaytonaMode()) {
    const info: DaytonaSandboxInfo = await createDaytonaSandbox(projectId, gitUrl)
    return {
      sandboxPath: null,
      daytonaSandboxId: info.sandboxId,
      daytonaOpencodeUrl: info.opencodeUrl,
    }
  }

  const sandboxPath = join(SANDBOX_ROOT, projectId)

  if (!existsSync(SANDBOX_ROOT)) {
    await mkdir(SANDBOX_ROOT, { recursive: true })
  }

  if (existsSync(sandboxPath)) {
    await rm(sandboxPath, { recursive: true, force: true })
  }

  if (gitUrl) {
    await mkdir(sandboxPath, { recursive: true })
    execSync(`git clone ${gitUrl} .`, { cwd: sandboxPath, stdio: 'pipe', timeout: 120000 })
  } else {
    await mkdir(sandboxPath, { recursive: true })
    execSync('git init', { cwd: sandboxPath, stdio: 'pipe', timeout: 10000 })
  }

  return { sandboxPath, daytonaSandboxId: null, daytonaOpencodeUrl: null }
}

export async function deleteSandbox(info: SandboxInfo): Promise<void> {
  if (info.daytonaSandboxId) {
    await deleteDaytonaSandbox(info.daytonaSandboxId)
    return
  }

  if (info.sandboxPath) {
    try {
      await access(info.sandboxPath)
      await rm(info.sandboxPath, { recursive: true, force: true })
    } catch {
      // Directory doesn't exist, nothing to do
    }
  }
}

export function getSandboxPath(projectId: string): string {
  return join(SANDBOX_ROOT, projectId)
}

export function scanSandboxDirectories(userId: string): number {
  const db = getDb()
  let imported = 0

  if (!existsSync(SANDBOX_ROOT)) return 0

  const entries = readdirSync(SANDBOX_ROOT, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const sandboxPath = join(SANDBOX_ROOT, entry.name)

    const existing = db.exec(
      'SELECT id FROM projects WHERE sandbox_path = ?',
      [sandboxPath]
    )
    if (existing[0]?.values?.length) continue

    const projectId = uuid()
    db.run(
      'INSERT INTO projects (id, user_id, name, status, sandbox_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))',
      [projectId, userId, entry.name, 'ready', sandboxPath]
    )
    imported++
  }

  if (imported > 0) {
    saveDb()
    console.log(`[sandbox] Imported ${imported} sandbox director${imported === 1 ? 'y' : 'ies'} as projects`)
  }
  return imported
}

export async function writeSandboxFile(
  sandboxPath: string | null,
  daytonaSandboxId: string | null,
  filePath: string,
  content: string,
): Promise<void> {
  if (daytonaSandboxId) {
    await writeDaytonaFile(daytonaSandboxId, filePath, content)
  } else if (sandboxPath) {
    const fullPath = join(sandboxPath, filePath)
    await writeFile(fullPath, content, 'utf-8')
  }
}

export async function readSandboxFile(
  sandboxPath: string | null,
  daytonaSandboxId: string | null,
  filePath: string,
): Promise<string | null> {
  if (daytonaSandboxId) {
    const buf = await readDaytonaFile(daytonaSandboxId, filePath)
    return buf?.toString('utf-8') ?? null
  }
  if (sandboxPath) {
    const fullPath = join(sandboxPath, filePath)
    try {
      return await readFile(fullPath, 'utf-8')
    } catch {
      return null
    }
  }
  return null
}

export function getProjectSandboxInfo(projectId: string): SandboxInfo | null {
  try {
    const db = getDb()
    const result = db.exec(
      'SELECT sandbox_path, daytona_sandbox_id, daytona_opencode_url FROM projects WHERE id = ?',
      [projectId]
    )
    const row = result[0]?.values?.[0]
    if (!row) return null
    return {
      sandboxPath: (row[0] as string) || null,
      daytonaSandboxId: (row[1] as string) || null,
      daytonaOpencodeUrl: (row[2] as string) || null,
    }
  } catch {
    return null
  }
}
