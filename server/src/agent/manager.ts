import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'

interface OpenCodeInstance {
  client: OpencodeClient
  refCount: number
}

/**
 * Manages opencode client connections per sandbox directory.
 * Connects to the existing opencode server (port 4096) with
 * per-request directory isolation via the `directory` query param.
 */
class OpenCodeManager {
  private instances = new Map<string, OpenCodeInstance>()
  private baseClient: OpencodeClient | null = null

  async getOrCreate(sandboxPath: string): Promise<OpencodeClient> {
    const existing = this.instances.get(sandboxPath)
    if (existing) {
      existing.refCount++
      return existing.client
    }

    if (!this.baseClient) {
      this.baseClient = createOpencodeClient({
        baseUrl: 'http://127.0.0.1:4096',
      })
    }

    const entry: OpenCodeInstance = {
      client: this.baseClient,
      refCount: 1,
    }

    this.instances.set(sandboxPath, entry)
    return entry.client
  }

  async release(sandboxPath: string): Promise<void> {
    const entry = this.instances.get(sandboxPath)
    if (!entry) return

    entry.refCount--
    if (entry.refCount <= 0) {
      this.instances.delete(sandboxPath)
    }
  }

  getInstance(sandboxPath: string): OpenCodeInstance | undefined {
    return this.instances.get(sandboxPath)
  }
}

export const openCodeManager = new OpenCodeManager()
