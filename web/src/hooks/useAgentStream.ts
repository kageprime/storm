import { useState, useEffect, useCallback, useRef } from 'react'
import * as api from '../lib/api'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  type: 'text' | 'plan' | 'steer_options' | 'step_progress' | 'step_complete' | 'error' | 'done'
  data?: Record<string, unknown>
  timestamp: number
}

export function useAgentStream(projectId: string | null, goalId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [goalStatus, setGoalStatus] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)
  const [pendingSteer, setPendingSteer] = useState<{
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

    // Cleanup previous connection
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
          text: `I've created a plan with ${res.goal.totalSteps} steps. Review and approve to start execution.`,
          type: 'plan',
          data: { plan: res.goal.plan },
          timestamp: Date.now(),
        })
      }
    })

    // Connect to SSE
    const disconnect = api.connectGoalStream(projectId, goalId, (event) => {
      switch (event.type) {
        case 'status_change': {
          const status = event.data.status as string
          setGoalStatus(status)
          addMessage({
            role: 'system',
            text: (event.data.message as string) || `Status: ${status}`,
            type: 'text',
            timestamp: event.timestamp,
          })
          break
        }
        case 'plan_ready': {
          const plan = event.data.plan as Array<{ step: number; description: string; files: string[] }>
          const total = event.data.totalSteps as number
          setTotalSteps(total)
          addMessage({
            role: 'assistant',
            text: `I've created a plan with ${total} steps.`,
            type: 'plan',
            data: { plan },
            timestamp: event.timestamp,
          })
          break
        }
        case 'step_start': {
          const stepNum = event.data.step as number
          setCurrentStep(stepNum)
          addMessage({
            role: 'assistant',
            text: `**Step ${stepNum}:** ${event.data.description as string}`,
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
        case 'step_complete': {
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
          setPendingSteer({
            prompt: event.data.prompt as string,
            options: event.data.options as Array<{ label: string; action: string }>,
          })
          addMessage({
            role: 'assistant',
            text: event.data.prompt as string,
            type: 'steer_options',
            data: { options: event.data.options },
            timestamp: event.timestamp,
          })
          break
        }
        case 'error': {
          setGoalStatus('failed')
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
          addMessage({
            role: 'system',
            text: `🏁 ${event.data.message as string}`,
            type: 'done',
            data: { status },
            timestamp: event.timestamp,
          })
          setPendingSteer(null)
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
    async (action: string) => {
      if (!projectId || !goalId) return
      setPendingSteer(null)
      addMessage({
        role: 'user',
        text: action === 'approve' ? 'Approved — proceed with the plan.' : `Action: ${action}`,
        type: 'text',
        timestamp: Date.now(),
      })
      try {
        await api.steerGoal(projectId, goalId, action)
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
    steer,
  }
}
