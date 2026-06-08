import { useState, useEffect, useCallback, useRef } from 'react'
import * as api from '../lib/api'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  type: 'text' | 'plan' | 'user_message' | 'steer_options' | 'step_progress' | 'step_complete' | 'tool_call' | 'error' | 'done'
  data?: Record<string, unknown>
  timestamp: number
}

export function useAgentStream(projectId: string | null, goalId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [goalStatus, setGoalStatus] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [fileChangeCount, setFileChangeCount] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)
  const [pendingSteer, setPendingSteer] = useState<{
    prompt: string
    options: Array<{ label: string; action: string }>
  } | null>(null)
  const [failureSteer, setFailureSteer] = useState<{
    prompt: string
    options: Array<{ label: string; action: string }>
  } | null>(null)
  const disconnectRef = useRef<(() => void) | null>(null)
  const idCounter = useRef(0)

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
        setPendingSteer({
          prompt: 'Here is my plan. Shall I proceed?',
          options: [
            { label: 'Approve', action: 'approve' },
            { label: 'Regenerate plan', action: 'regenerate' },
          ],
        })
        addMessage({
          role: 'assistant',
          text: `I've created a plan with ${res.goal.totalSteps} steps. Review and approve to start execution.`,
          type: 'plan',
          data: { plan: res.goal.plan },
          timestamp: Date.now(),
        })
      }
    })

    const disconnect = api.connectGoalStream(projectId, goalId, (event) => {
      switch (event.type) {
        case 'status_change': {
          setGoalStatus(event.data.status as string)
          addMessage({
            role: 'system',
            text: (event.data.message as string) || `Status: ${event.data.status as string}`,
            type: 'text',
            timestamp: event.timestamp,
          })
          break
        }
        case 'plan_ready': {
          const plan = event.data.plan as Array<{ step: number; description: string; files: string[] }>
          const total = event.data.totalSteps as number
          setGoalStatus('awaiting_approval')
          setTotalSteps(total)
          setPendingSteer({
            prompt: 'Here is my plan. Shall I proceed?',
            options: [
              { label: 'Approve', action: 'approve' },
              { label: 'Regenerate plan', action: 'regenerate' },
            ],
          })
          addMessage({
            role: 'assistant',
            text: `I've created a plan with ${total} steps. Review and approve to start execution.`,
            type: 'plan',
            data: { plan },
            timestamp: event.timestamp,
          })
          break
        }
        case 'step_start': {
          setPendingSteer(null)
          setFailureSteer(null)
          setCurrentStep(event.data.step as number)
          addMessage({
            role: 'assistant',
            text: `**Step ${event.data.step as number}:** ${event.data.description as string}`,
            type: 'text',
            data: { files: event.data.files as string[] },
            timestamp: event.timestamp,
          })
          break
        }
        case 'step_progress': {
          addMessage({
            role: 'assistant',
            text: (event.data.message as string) || 'Working...',
            type: 'step_progress',
            data: event.data,
            timestamp: event.timestamp,
          })
          break
        }
        case 'tool_call': {
          addMessage({
            role: 'system',
            text: '',
            type: 'tool_call',
            data: event.data,
            timestamp: event.timestamp,
          })
          break
        }
        case 'file_edit': {
          // Triggers tree refresh; no message needed
          break
        }
        case 'step_complete': {
          setFileChangeCount((c) => c + 1)
          addMessage({
            role: 'assistant',
            text: `✅ **Step ${event.data.step as number} complete:** ${event.data.summary as string}`,
            type: 'step_complete',
            data: event.data,
            timestamp: event.timestamp,
          })
          break
        }
        case 'steering_needed': {
          const options = event.data.options as Array<{ label: string; action: string }>
          if (options.some((o) => o.action === 'approve')) {
            setPendingSteer({ prompt: event.data.prompt as string, options })
          } else {
            setFailureSteer({ prompt: event.data.prompt as string, options })
          }
          addMessage({
            role: 'assistant',
            text: event.data.prompt as string,
            type: 'steer_options',
            data: { options },
            timestamp: event.timestamp,
          })
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
          setPendingSteer(null)
          setFailureSteer(null)
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
          setPendingSteer(null)
          setFailureSteer(null)
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
      } else if (action === 'approve') {
        setPendingSteer(null)
        addMessage({
          role: 'user',
          text: 'Approved — proceed with the plan.',
          type: 'text',
          timestamp: Date.now(),
        })
      } else if (action === 'regenerate') {
        setPendingSteer(null)
        addMessage({
          role: 'user',
          text: 'Regenerate the plan.',
          type: 'text',
          timestamp: Date.now(),
        })
      } else if (action === 'stop') {
        setPendingSteer(null)
        setFailureSteer(null)
        addMessage({
          role: 'user',
          text: 'Stop execution.',
          type: 'text',
          timestamp: Date.now(),
        })
      } else {
        setFailureSteer(null)
        addMessage({
          role: 'user',
          text: `Action: ${action}`,
          type: 'text',
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
    pendingSteer,
    failureSteer,
    steer,
    fileChangeCount,
  }
}
