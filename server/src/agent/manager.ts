import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'

interface OpenCodeInstance {
  client: OpencodeClient
  refCount: number
}

class OpenCodeManager {
  private instances = new Map<string, OpenCodeInstance>()
  private clients = new Map<string, OpencodeClient>()

  async getOrCreate(key: string, baseUrl?: string): Promise<OpencodeClient> {
    const existing = this.instances.get(key)
    if (existing) {
      existing.refCount++
      return existing.client
    }

    let client = this.clients.get(baseUrl || 'default')
    if (!client) {
      client = createOpencodeClient({
        baseUrl: baseUrl || 'http://127.0.0.1:4096',
      })
      this.clients.set(baseUrl || 'default', client)
    }

    const entry: OpenCodeInstance = {
      client,
      refCount: 1,
    }

    this.instances.set(key, entry)
    return entry.client
  }

  async release(key: string): Promise<void> {
    const entry = this.instances.get(key)
    if (!entry) return

    entry.refCount--
    if (entry.refCount <= 0) {
      this.instances.delete(key)
    }
  }

  getInstance(key: string): OpenCodeInstance | undefined {
    return this.instances.get(key)
  }
}

export const openCodeManager = new OpenCodeManager()
