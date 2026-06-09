import type { OpencodeClient, Event } from '@opencode-ai/sdk'
import type { EventMessagePartUpdated, EventSessionIdle, EventSessionError, EventFileEdited } from '@opencode-ai/sdk'
import { CODING_CONVENTIONS, promptForAgent } from './planner.js'

export type ExecutorEvent = {
  type: 'step_progress' | 'tool_call' | 'file_edit' | 'text' | 'error' | 'step_complete'
  data: Record<string, unknown>
  timestamp: number
}

export type EventCallback = (event: ExecutorEvent) => void

const STEP_TIMEOUT = 10 * 60 * 1000

export async function executeStep(
  client: OpencodeClient,
  sandboxPath: string | null,
  stepDescription: string,
  context: string,
  onEvent: EventCallback,
  agentName?: string,
  systemPrompt?: string,
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

  const query = sandboxPath ? { directory: sandboxPath } : {}

  try {
    const sessionRes = await client.session.create({
      body: { title: stepDescription.slice(0, 100) },
      query,
    })
    const sessionData = sessionRes.data as { id?: string } | undefined
    if (!sessionData?.id) throw new Error('Failed to create execution session')
    const sessionId = sessionData.id

    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(new Error('Step execution timed out')), STEP_TIMEOUT)

    const eventResult = await client.event.subscribe({
      signal: ac.signal as AbortSignal,
      query: sandboxPath ? { directory: sandboxPath } : undefined,
    })
    const stream = eventResult.stream as AsyncGenerator<Event>

    const system = systemPrompt || promptForAgent(agentName) || CODING_CONVENTIONS

    await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        model: { providerID: 'opencode', modelID: 'deepseek-v4-flash-free' },
        system,
      },
      query,
    })

    let sessionError: string | null = null
    let finalSummary = ''
    const emittedFiles = new Set<string>()

    for await (const raw of stream) {
      const event = raw as Event
      const props = event.properties as Record<string, unknown> | undefined
      if (props?.sessionID !== sessionId) continue

      if (event.type === 'message.part.updated') {
        const part = (event as EventMessagePartUpdated).properties.part
        if (!part) continue

        if (part.type === 'text' && part.text) {
          onEvent({
            type: 'step_progress',
            data: { message: part.text },
            timestamp: Date.now(),
          })
        } else if (part.type === 'tool') {
          const state = (part.state as Record<string, unknown>) || {}
          const input = (state.input as Record<string, unknown>) || {}
          const fileName = (input.path as string) || (input.file as string) || (input.file_path as string) || ''
          const status = (state.status as string) || 'completed'

          onEvent({
            type: 'tool_call',
            data: {
              tool: part.tool || 'unknown',
              callID: part.callID || '',
              input,
              output: (state.output as string) || (state.error as string) || '',
              status,
              title: (state.title as string) || '',
              file: fileName,
            },
            timestamp: Date.now(),
          })

          if (fileName && (status === 'completed' || status === 'error')) {
            const key = `${part.id}:${fileName}`
            if (!emittedFiles.has(key)) {
              emittedFiles.add(key)
              onEvent({
                type: 'file_edit',
                data: { file: fileName },
                timestamp: Date.now(),
              })
            }
          }
        }
      } else if (event.type === 'file.edited') {
        const filePath = (event as EventFileEdited).properties.file
        if (filePath) {
          onEvent({
            type: 'file_edit',
            data: { file: filePath },
            timestamp: Date.now(),
          })
        }
      } else if (event.type === 'session.idle') {
        break
      } else if (event.type === 'session.error') {
        const errObj = (event as EventSessionError).properties?.error as Record<string, unknown> | undefined
        sessionError = (errObj?.message as string) || 'Session error occurred'
        onEvent({
          type: 'error',
          data: { message: sessionError },
          timestamp: Date.now(),
        })
        break
      }
    }

    clearTimeout(timeout)
    ac.abort()

    if (sessionError) {
      return { success: false, summary: sessionError }
    }

    try {
      const msgRes = await client.session.messages({
        path: { id: sessionId },
      })
      const messages = (msgRes.data as Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>) || []
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
      if (lastAssistant?.parts) {
        const texts = lastAssistant.parts
          .filter(p => p.type === 'text')
          .map(p => p.text || '')
          .filter(Boolean)
        if (texts.length > 0) finalSummary = texts.join('\n')
      }
    } catch {
      // Non-critical
    }

    onEvent({
      type: 'step_complete',
      data: { summary: finalSummary.slice(0, 500) },
      timestamp: Date.now(),
    })

    return { success: true, summary: finalSummary.slice(0, 500) }
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
