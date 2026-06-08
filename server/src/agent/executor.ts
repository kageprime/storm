import type { OpencodeClient } from '@opencode-ai/sdk'

export type ExecutorEvent = {
  type: 'step_progress' | 'tool_call' | 'file_edit' | 'text' | 'error' | 'step_complete'
  data: Record<string, unknown>
  timestamp: number
}

export type EventCallback = (event: ExecutorEvent) => void

/**
 * Executes a single sub-task via opencode and streams events back.
 * Reuses the same session across steps for context continuity.
 */
export async function executeStep(
  client: OpencodeClient,
  sandboxPath: string,
  stepDescription: string,
  context: string,
  onEvent: EventCallback,
): Promise<{ success: boolean; summary: string }> {
  const prompt = `## Current Task
${stepDescription}

## Context from previous steps
${context}

Please complete this task. Work in the project directory and make all necessary changes.`

  onEvent({
    type: 'step_progress',
    data: { message: 'Starting task...' },
    timestamp: Date.now(),
  })

  try {
    // Create a fresh session for each step to avoid context issues
    const sessionRes = await client.session.create({
      body: { title: stepDescription.slice(0, 100) },
      query: { directory: sandboxPath },
    })
    const sessionData = sessionRes.data as { id?: string } | undefined
    if (!sessionData?.id) throw new Error('Failed to create execution session')
    const sessionId = sessionData.id

    const result = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        model: { providerID: 'opencode', modelID: 'deepseek-v4-flash-free' },
      },
      query: { directory: sandboxPath },
    })

    const info = result.data as { info?: { error?: { message?: string } }; parts?: Array<{ type?: string; text?: string }> }

    if (info?.info?.error) {
      onEvent({
        type: 'error',
        data: { message: info.info.error.message || 'Unknown error' },
        timestamp: Date.now(),
      })

      return { success: false, summary: info.info.error.message || 'Task failed' }
    }

    const textParts = info?.parts?.filter((p) => p.type === 'text') ?? []
    const summary = textParts.map((p) => p.text ?? '').join('\n')

    onEvent({
      type: 'step_complete',
      data: { summary: summary.slice(0, 500) },
      timestamp: Date.now(),
    })

    return { success: true, summary: summary.slice(0, 500) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    onEvent({
      type: 'error',
      data: { message },
      timestamp: Date.now(),
    })

    return { success: false, summary: message }
  }
}
