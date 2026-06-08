import { mkdir, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const SANDBOX_ROOT = process.env.SANDBOX_ROOT || join(process.cwd(), 'sandboxes')

/**
 * Create a sandbox directory for a project.
 * If gitUrl is provided, clones the repo; otherwise creates an empty directory.
 */
export async function createSandbox(projectId: string, gitUrl: string | null): Promise<string> {
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

  return sandboxPath
}

/**
 * Delete a sandbox directory.
 */
export async function deleteSandbox(sandboxPath: string): Promise<void> {
  try {
    await access(sandboxPath)
    await rm(sandboxPath, { recursive: true, force: true })
  } catch {
    // Directory doesn't exist, nothing to do
  }
}

/**
 * Get the sandbox path for a project.
 */
export function getSandboxPath(projectId: string): string {
  return join(SANDBOX_ROOT, projectId)
}
