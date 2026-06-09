import { useState, useEffect, useCallback, useRef } from 'react'
import * as api from '../lib/api'
import type { StepState } from '../components/StepTimeline'

export type SteerOption = { label: string; action: string }

export type AgentLogEntry = {
  id: string
  type: 'step_start' | 'tool_call' | 'file_edit' | 'step_complete' | 'error' | 'parallel_start' | 'parallel_complete'
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

type ParallelStepState = {
  step: number
  description: string
  toolCalls: Record<string, unknown>[]
}

function buildStepStatesFromMessages(messages: ChatMessage[]): Record<number, StepState> {
  const map: Record<number, StepState> = {}
  for (const msg of messages) {
    if (msg.type === 'step_turn') {
      const step = (msg.data?.step as number) || 0
      const success = (msg.data?.success as boolean) ?? true
      map[step] = {
        step,
        description: (msg.data?.description as string) || '',
        status: success ? 'completed' : 'failed',
        summary: (msg.data?.summary as string) || '',
        toolCalls: msg.data?.toolCalls as Record<string, unknown>[] | undefined,
      }
    } else if (msg.type === 'step_failure') {
      const step = (msg.data?.step as number) || 0
      map[step] = {
        step,
        description: (msg.data?.description as string) || '',
        status: 'failed',
        toolCalls: msg.data?.toolCalls as Record<string, unknown>[] | undefined,
        steerOptions: msg.data?.steerOptions as SteerOption[] | undefined,
      }
    }
  }
  return map
}

export function useAgentStream(projectId: string | null, goalId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [goalStatus, setGoalStatus] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [fileChangeCount, setFileChangeCount] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([])
  const [lastHtmlFile, setLastHtmlFile] = useState<string | null>(null)
  const [stepStates, setStepStates] = useState<Record<number, StepState>>({})
  const disconnectRef = useRef<(() => void) | null>(null)
  const idCounter = useRef(0)
  const currentStepRef = useRef(0)

  // Buffers for grouping events into turns (for message persistence)
  const planBuffer = useRef<api.SubTask[] | null>(null)
  const toolCallBuffer = useRef<Record<string, unknown>[]>([])
  const stepBuffer = useRef<{ step: number; description: string } | null>(null)
  const parallelSteps = useRef<Map<number, ParallelStepState>>(new Map())

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
    setStepStates({})

    // Load persisted messages from server
    api.getGoalMessages(projectId, goalId).then((res) => {
      if (disconnectRef.current === null) return // component unmounted
      const mapped: ChatMessage[] = res.messages.map((msg) =>
        fromServerMessage(msg, `msg-${++idCounter.current}`)
      )
      setMessages(mapped)
      setStepStates(buildStepStatesFromMessages(mapped))
    })

    // Fetch initial goal state
    api.getGoal(projectId, goalId).then((res) => {
      setGoalStatus(res.goal.status)
      setCurrentStep(res.goal.currentStep)
      currentStepRef.current = res.goal.currentStep
      setTotalSteps(res.goal.totalSteps)
    })

    const disconnect = api.connectGoalStream(projectId, goalId, (event) => {
      switch (event.type) {
        case 'status_change': {
          setGoalStatus(event.data.status as string)
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
        case 'parallel_start': {
          const steps = event.data.steps as Array<{ step: number; description: string; agent?: string; files?: string[] }>
          parallelSteps.current = new Map(
            steps.map(s => [s.step, { step: s.step, description: s.description, toolCalls: [] }])
          )
          setStepStates(prev => {
            const next = { ...prev }
            for (const s of steps) {
              next[s.step] = { step: s.step, description: s.description, status: 'active', toolCalls: [] }
            }
            return next
          })
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'parallel_start', timestamp: event.timestamp, data: event.data },
          ])
          break
        }
        case 'parallel_complete': {
          parallelSteps.current = new Map()
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'parallel_complete', timestamp: event.timestamp, data: event.data },
          ])
          break
        }
        case 'step_start': {
          const stepNum = event.data.step as number
          currentStepRef.current = stepNum
          const ps = parallelSteps.current
          if (ps.size > 0) {
            const existing = ps.get(stepNum)
            if (existing) {
              existing.description = (event.data.description as string) || existing.description
            }
          } else {
            stepBuffer.current = {
              step: stepNum,
              description: event.data.description as string,
            }
            toolCallBuffer.current = []
          }
          setCurrentStep(stepNum)
          setStepStates(prev => {
            const existing = prev[stepNum]
            return {
              ...prev,
              [stepNum]: {
                step: stepNum,
                description: (event.data.description as string) || existing?.description || '',
                status: 'active',
                toolCalls: existing?.toolCalls || [],
              },
            }
          })
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'step_start', timestamp: event.timestamp, data: event.data },
          ])
          break
        }
        case 'step_progress': {
          break
        }
        case 'tool_call': {
          const ps = parallelSteps.current
          const stepNum = (event.data.step as number) || currentStepRef.current
          const tc = event.data as Record<string, unknown>
          if (ps.size > 0 && stepNum != null && ps.has(stepNum)) {
            ps.get(stepNum)!.toolCalls.push(tc)
          } else {
            toolCallBuffer.current.push(tc)
          }
          // Update step states in real-time so tool calls appear immediately
          setStepStates(prev => {
            const existing = prev[stepNum]
            if (!existing) return prev
            return {
              ...prev,
              [stepNum]: {
                ...existing,
                toolCalls: [...(existing.toolCalls || []), tc],
              },
            }
          })
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
          const stepNum = event.data.step as number
          const description = event.data.description as string
          const success = event.data.success as boolean
          const summary = event.data.summary as string
          const ps = parallelSteps.current

          setFileChangeCount((c) => c + 1)
          setAgentLogs((prev) => [
            ...prev,
            { id: `log-${++idCounter.current}`, type: 'step_complete', timestamp: event.timestamp, data: event.data },
          ])

          // Update step state
          setStepStates(prev => {
            const existing = prev[stepNum]
            return {
              ...prev,
              [stepNum]: {
                ...existing,
                step: stepNum,
                description: existing?.description || description,
                status: success ? 'completed' : 'failed',
                summary: summary || existing?.summary || '',
                toolCalls: existing?.toolCalls || [],
              },
            }
          })

          // Persist as chat message for page reload support
          if (ps.size > 0) {
            const entry = ps.get(stepNum)
            const toolCalls = entry ? [...entry.toolCalls] : []
            if (entry) entry.toolCalls = []
            if (success) {
              addMessage({
                role: 'assistant',
                text: `**Step ${stepNum}: ${description}**`,
                type: 'step_turn',
                data: {
                  step: stepNum,
                  description,
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                  success: true,
                  summary,
                },
                timestamp: event.timestamp,
              })
            }
          } else {
            if (success) {
              const toolCalls = [...toolCallBuffer.current]
              toolCallBuffer.current = []
              stepBuffer.current = null
              addMessage({
                role: 'assistant',
                text: `**Step ${stepNum}: ${description}**`,
                type: 'step_turn',
                data: {
                  step: stepNum,
                  description,
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                  success: true,
                  summary,
                },
                timestamp: event.timestamp,
              })
            } else {
              stepBuffer.current = { step: stepNum, description }
            }
          }
          break
        }
        case 'steering_needed': {
          const options = event.data.options as SteerOption[]

          if (options.some((o) => o.action === 'approve')) {
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
            // Mark all active steps as failed
            setStepStates(prev => {
              const next = { ...prev }
              for (const [stepNum, state] of Object.entries(prev)) {
                if (state.status === 'active') {
                  next[Number(stepNum)] = { ...state, status: 'failed', steerOptions: options }
                }
              }
              return next
            })

            const ps = parallelSteps.current
            if (ps.size > 0) {
              for (const entry of ps.values()) {
                addMessage({
                  role: 'assistant',
                  text: `**Step ${entry.step}: ${entry.description}**`,
                  type: 'step_failure',
                  data: {
                    step: entry.step,
                    description: entry.description,
                    toolCalls: entry.toolCalls.length > 0 ? [...entry.toolCalls] : undefined,
                    success: false,
                    steerOptions: options,
                  },
                  timestamp: event.timestamp,
                })
              }
              ps.clear()
            } else {
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
          parallelSteps.current = new Map()
          setStepStates({})
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
          parallelSteps.current = new Map()
          setStepStates({})
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
    stepStates,
  }
}
