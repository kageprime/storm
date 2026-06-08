import { useState, useEffect, useCallback, useRef } from 'react'
import * as api from '../lib/api'

export type SteerOption = { label: string; action: string }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  type: 'user_message' | 'plan_turn' | 'step_turn' | 'step_failure' | 'done' | 'error'
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

  useEffect(() => {
    if (!projectId || !goalId) return

    if (disconnectRef.current) {
      disconnectRef.current()
    }

    // Fetch initial goal state
    api.getGoal(projectId, goalId).then((res) => {
      setGoalStatus(res.goal.status)
      setCurrentStep(res.goal.currentStep)
      setTotalSteps(res.goal.totalSteps)

      if (res.goal.plan && res.goal.status === 'awaiting_approval') {
        addMessage({
          role: 'assistant',
          text: `I've created a plan with ${res.goal.totalSteps} steps.`,
          type: 'plan_turn',
          data: {
            plan: res.goal.plan,
            steerOptions: [
              { label: 'Approve', action: 'approve' },
              { label: 'Regenerate plan', action: 'regenerate' },
            ],
          },
          timestamp: Date.now(),
        })
      }
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
          break
        }
        case 'step_progress': {
          // Ignored — not useful for chat
          break
        }
        case 'tool_call': {
          toolCallBuffer.current.push(event.data as Record<string, unknown>)
          break
        }
        case 'file_edit': {
          // Triggers tree refresh; no message needed
          break
        }
        case 'step_complete': {
          const step = event.data.step as number
          const description = event.data.description as string
          const success = event.data.success as boolean
          const summary = event.data.summary as string

          setFileChangeCount((c) => c + 1)

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
  }
}
