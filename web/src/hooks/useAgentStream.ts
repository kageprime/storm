import { useState, useEffect, useCallback, useRef } from 'react'
import * as api from '../lib/api'

export type SteerOption = { label: string; action: string }

export type AgentLogEntry = {
  id: string
  type: 'step_start' | 'tool_call' | 'file_edit' | 'step_complete' | 'error'
  timestamp: number
  data: Record<string, unknown>
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  type: 'user_message' | 'plan_turn' | 'step_turn' | 'step_failure' | 'done' | 'error' | 'system'
  data?: {
    plan?: api.SubTask[]
    steerOptions?: SteerOption[]
    toolCalls?: Record<string, unknown>[]
    step?: number
    description?: string
    success?: boolean
    summary?: string
    status?: string
    [key: string]: unknown
  }
  timestamp: number
}

export function useAgentStream(projectId: string | null, goalId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [goalStatus, setGoalStatus] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [fileChangeCount, setFileChangeCount] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([])
  const [lastHtmlFile, setLastHtmlFile] = useState<string | null>(null)
  const disconnectRef = useRef<(() => void) | null>(null)
  const idCounter = useRef(0)

  // Buffers for grouping events into turns
  const planBuffer = useRef<api.SubTask[] | null>(null)
  const toolCallBuffer = useRef<Record<string, unknown>[]>([])
  const stepBuffer = useRef<{ step: number; description: string } | null>(null)

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    const id = `msg-${++idCounter.current}`
    setMessages((prev) => [...prev, { ...msg, id }])
  }, [])

  function fromServerMessage(msg: api.GoalMessage, id: string): ChatMessage {
    const meta = msg.metadata || {}
    let type: ChatMessage['type']
    let data: ChatMessage['data'] | undefined

    if (meta.plan) {
      type = 'plan_turn'
      data = { plan: meta.plan as api.SubTask[], steerOptions: meta.steerOptions as SteerOption[] | undefined }
    } else if (meta.status) {
      type = 'done'
      data = { status: meta.status as string }
    } else if (meta.success) {
      type = 'step_turn'
      data = {
        step: meta.step as number,
        description: meta.description as string,
        success: meta.success as boolean,
        summary: meta.summary as string,
        toolCalls: meta.toolCalls as Record<string, unknown>[] | undefined,
      }
    } else if (meta.steerOptions && meta.step) {
      type = 'step_failure'
      data = {
        step: meta.step as number,
        description: meta.description as string,
        steerOptions: meta.steerOptions as SteerOption[],
      }
    } else if (msg.role === 'user') {
      type = 'user_message'
      data = meta.action ? { action: meta.action as string } : undefined
    } else if (msg.content.startsWith('❌')) {
      type = 'error'
      data = meta.message ? { message: meta.message as string } : undefined
    } else {
      type = 'system'
      data = undefined
    }

    return { id, role: msg.role as ChatMessage['role'], text: msg.content, type, data, timestamp: msg.timestamp }
  }

  useEffect(() => {
    if (!projectId || !goalId) return

    if (disconnectRef.current) {
      disconnectRef.current()
    }

    setMessages([])
    setAgentLogs([])

    // Load persisted messages from server
    api.getGoalMessages(projectId, goalId).then((res) => {
      if (disconnectRef.current === null) return // component unmounted
      const mapped: ChatMessage[] = res.messages.map((msg) =>
        fromServerMessage(msg, `msg-${++idCounter.current}`)
      )
      setMessages(mapped)
    })

    // Fetch initial goal state
    api.getGoal(projectId, goalId).then((res) => {
      setGoalStatus(res.goal.status)
      setCurrentStep(res.goal.currentStep)
      setTotalSteps(res.goal.totalSteps)
    })

    const disconnect = api.connectGoalStream(projectId, goalId, (event) => {
      switch (event.type) {
        case 'status_change': {
          setGoalStatus(event.data.status as string)
          // Don't add a message — just update state
          break
        }
        case 'plan_ready': {
          const plan = event.data.plan as api.SubTask[]
          const total = event.data.totalSteps as number
          setGoalStatus('awaiting_approval')
          setTotalSteps(total)
          planBuffer.current = plan
          break
        }
        case 'step_start': {
          stepBuffer.current = {
            step: event.data.step as number,
            description: event.data.description as string,
          }
          toolCallBuffer.current = []
          setCurrentStep(event.data.step as number)
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'step_start', timestamp: event.timestamp, data: event.data },
          ])
          break
        }
        case 'step_progress': {
          // Ignored — not useful for chat
          break
        }
        case 'tool_call': {
          toolCallBuffer.current.push(event.data as Record<string, unknown>)
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'tool_call', timestamp: event.timestamp, data: event.data },
          ])
          break
        }
        case 'file_edit': {
          const fp = (event.data.file as string) || (event.data.path as string) || ''
          if (fp && /\.html?$/i.test(fp)) {
            setLastHtmlFile(fp)
          }
          setFileChangeCount((c) => c + 1)
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'file_edit', timestamp: event.timestamp, data: event.data },
          ])
          break
        }
        case 'step_complete': {
          const step = event.data.step as number
          const description = event.data.description as string
          const success = event.data.success as boolean
          const summary = event.data.summary as string

          setFileChangeCount((c) => c + 1)
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'step_complete', timestamp: event.timestamp, data: event.data },
          ])

          if (success) {
            const toolCalls = [...toolCallBuffer.current]
            toolCallBuffer.current = []
            stepBuffer.current = null

            addMessage({
              role: 'assistant',
              text: `**Step ${step}: ${description}**`,
              type: 'step_turn',
              data: {
                step,
                description,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                success: true,
                summary,
              },
              timestamp: event.timestamp,
            })
          } else {
            // Keep step info and tool calls buffered — steering_needed follows
            stepBuffer.current = { step, description }
          }
          break
        }
        case 'steering_needed': {
          const options = event.data.options as SteerOption[]

          if (options.some((o) => o.action === 'approve')) {
            // Flush plan buffer
            const plan = planBuffer.current
            planBuffer.current = null
            if (plan) {
              addMessage({
                role: 'assistant',
                text: `I've created a plan with ${plan.length} steps.`,
                type: 'plan_turn',
                data: { plan, steerOptions: options },
                timestamp: event.timestamp,
              })
            }
          } else {
            // Flush failure step buffer
            const step = stepBuffer.current
            const toolCalls = [...toolCallBuffer.current]
            toolCallBuffer.current = []
            stepBuffer.current = null
            if (step) {
              addMessage({
                role: 'assistant',
                text: `**Step ${step.step}: ${step.description}**`,
                type: 'step_failure',
                data: {
                  step: step.step,
                  description: step.description,
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                  success: false,
                  steerOptions: options,
                },
                timestamp: event.timestamp,
              })
            } else {
              addMessage({
                role: 'assistant',
                text: event.data.prompt as string,
                type: 'step_failure',
                data: { steerOptions: options },
                timestamp: event.timestamp,
              })
            }
          }
          break
        }
        case 'user_message': {
          addMessage({
            role: 'system',
            text: `✉️ ${event.data.text as string}`,
            type: 'user_message',
            timestamp: event.timestamp,
          })
          break
        }
        case 'error': {
          setGoalStatus('failed')
          planBuffer.current = null
          toolCallBuffer.current = []
          stepBuffer.current = null
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'error', timestamp: event.timestamp, data: event.data },
          ])
          addMessage({
            role: 'system',
            text: `❌ Error: ${event.data.message as string}`,
            type: 'error',
            timestamp: event.timestamp,
          })
          break
        }
        case 'done': {
          const status = event.data.status as string
          setGoalStatus(status)
          planBuffer.current = null
          toolCallBuffer.current = []
          stepBuffer.current = null
          addMessage({
            role: 'system',
            text: `🏁 ${event.data.message as string}`,
            type: 'done',
            data: { status },
            timestamp: event.timestamp,
          })
          break
        }
      }
    })

    disconnectRef.current = disconnect

    return () => {
      disconnect()
      disconnectRef.current = null
    }
  }, [projectId, goalId, addMessage])

  const steer = useCallback(
    async (action: string, payload?: Record<string, unknown>) => {
      if (!projectId || !goalId) return

      if (action === 'message') {
        addMessage({
          role: 'user',
          text: (payload?.text as string) || '',
          type: 'user_message',
          timestamp: Date.now(),
        })
      } else {
        const labels: Record<string, string> = {
          approve: 'Approved — proceed',
          regenerate: 'Regenerate the plan',
          stop: 'Stop execution',
          redo: 'Retry step',
          skip: 'Skip step',
        }
        addMessage({
          role: 'user',
          text: labels[action] || `Action: ${action}`,
          type: 'user_message',
          timestamp: Date.now(),
        })
      }

      try {
        await api.steerGoal(projectId, goalId, action, payload)
      } catch (err) {
        addMessage({
          role: 'system',
          text: `❌ Steering failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          type: 'error',
          timestamp: Date.now(),
        })
      }
    },
    [projectId, goalId, addMessage]
  )

  return {
    messages,
    goalStatus,
    currentStep,
    totalSteps,
    steer,
    fileChangeCount,
    addMessage,
    agentLogs,
    lastHtmlFile,
  }
}
