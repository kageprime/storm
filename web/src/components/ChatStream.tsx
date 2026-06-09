import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, SteerOption } from '../hooks/useAgentStream'
import type { SubTask } from '../lib/api'
import { StepTimeline, type StepState } from './StepTimeline'
import { FormattedText } from './FormattedText'

type Props = {
  messages: ChatMessage[]
  onSteer: (action: string, payload?: Record<string, unknown>) => void
  goalStatus: string | null
  currentStep: number
  totalSteps: number
  liveStepStates?: Record<number, StepState>
}

export function ChatStream({ messages, onSteer, goalStatus, currentStep, totalSteps, liveStepStates }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const isExecuting = goalStatus === 'executing'
  const isPlanning = goalStatus === 'planning'
  const isAwaitingApproval = goalStatus === 'awaiting_approval'

  const plan = extractPlan(messages)
  const isLive = liveStepStates && Object.keys(liveStepStates).length > 0
  const stepStates = isLive ? mergeWithPlan(liveStepStates, plan, currentStep) : buildStepStates(messages, currentStep)

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-full bg-storm-accent/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-storm-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <p className="text-storm-muted text-sm max-w-md">
            Describe what you want to build. The agent will create a plan, then execute it step by step after you approve.
          </p>
        </div>
      )}

      {groupByTurns(messages).map((turn, gi) => (
        <div key={gi} className="space-y-4">
          {/* User message */}
          {turn.user && <UserBubble message={turn.user} />}

          {/* AI response — all non-user messages in one bubble */}
          {turn.responses.length > 0 && (
            <AiResponseBubble
              messages={turn.responses}
              plan={plan}
              stepStates={stepStates}
              onSteer={onSteer}
              isExecuting={isExecuting}
              isPlanning={isPlanning}
              goalStatus={goalStatus}
            />
          )}
        </div>
      ))}

      {/* Loading indicator during planning */}
      {(isPlanning || (isAwaitingApproval && messages.length === 1)) && (
        <div className="flex items-center gap-2.5 text-storm-muted text-sm py-2">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-storm-accent/60 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-storm-accent/60 animate-pulse" style={{ animationDelay: '0.15s' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-storm-accent/60 animate-pulse" style={{ animationDelay: '0.3s' }} />
          </div>
          <span className="text-storm-muted/70">Planning...</span>
        </div>
      )}
      {isExecuting && (
        <div className="flex items-center gap-2.5 text-storm-muted text-sm py-2">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-storm-accent/60 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-storm-accent/60 animate-pulse" style={{ animationDelay: '0.15s' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-storm-accent/60 animate-pulse" style={{ animationDelay: '0.3s' }} />
          </div>
          <span className="text-storm-muted/70">Working...</span>
        </div>
      )}

      {isExecuting && (
        <div className="flex justify-center pt-1">
          <button
            onClick={() => onSteer('stop')}
            className="px-3 py-1 text-xs text-red-400/70 border border-red-800/30 rounded-full hover:bg-red-900/15 hover:text-red-300 transition-colors"
          >
            Stop execution
          </button>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

/* ---------- Turn Grouping ---------- */

type Turn = {
  user: ChatMessage | null
  responses: ChatMessage[]
}

function groupByTurns(msgs: ChatMessage[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn = { user: null, responses: [] }

  for (const msg of msgs) {
    if (msg.role === 'user') {
      if (current.user || current.responses.length > 0) {
        turns.push(current)
        current = { user: null, responses: [] }
      }
      current.user = msg
    } else {
      current.responses.push(msg)
    }
  }
  if (current.user || current.responses.length > 0) {
    turns.push(current)
  }
  return turns
}

/* ---------- AI Response Bubble ---------- */

function AiResponseBubble({
  messages,
  plan,
  stepStates,
  onSteer,
  isExecuting,
  isPlanning,
  goalStatus,
}: {
  messages: ChatMessage[]
  plan: SubTask[]
  stepStates: StepState[]
  onSteer: (action: string, payload?: Record<string, unknown>) => void
  isExecuting: boolean
  isPlanning: boolean
  goalStatus: string | null
}) {
  const hasPlanTurn = messages.some((m) => m.type === 'plan_turn')
  const hasSteps = messages.some((m) => m.type === 'step_turn' || m.type === 'step_failure')
  const needsApproval = hasPlanTurn && !isExecuting && (goalStatus === 'awaiting_approval' || goalStatus === 'planning')
  const showTimeline = plan.length > 0 && !needsApproval && hasSteps

  return (
    <div className="flex gap-3 animate-in">
      <AssistantAvatar />
      <div className="flex-1 max-w-[85%] sm:max-w-[75%] space-y-2">
        <div className="msg-ai rounded-xl px-4 py-3 space-y-3">
          {/* Text sections (system messages, assistant text) */}
          {messages.filter(isDisplayMessage).map((msg) => {
            if (msg.type === 'plan_turn') {
              const plan = (msg.data?.plan as SubTask[]) || []
              const options = needsApproval ? (msg.data?.steerOptions as SteerOption[] | undefined) : undefined
              return (
                <PlanNotice
                  key={msg.id}
                  count={plan.length}
                  steerOptions={options}
                  onSteer={onSteer}
                  disabled={isPlanning || isExecuting}
                />
              )
            }
            if (msg.type === 'step_turn' || msg.type === 'step_failure') return null
            if (msg.type === 'done') {
              const status = (msg.data?.status as string) || ''
              return <DoneBanner key={msg.id} status={status} text={msg.text} />
            }
            if (msg.type === 'error') {
              return (
                <div key={msg.id} className="text-sm text-red-300 leading-relaxed">
                  <FormattedText text={msg.text} />
                </div>
              )
            }
            return (
              <div key={msg.id} className="text-sm text-storm-text leading-relaxed">
                <FormattedText text={msg.text} />
              </div>
            )
          })}

          {/* Step timeline (inline, after plan is approved) */}
          {showTimeline && (
            <StepTimeline plan={plan} steps={stepStates} onSteer={onSteer} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Plan Notice ---------- */

function PlanNotice({
  count,
  steerOptions,
  onSteer,
  disabled,
}: {
  count: number
  steerOptions?: SteerOption[]
  onSteer: (action: string, payload?: Record<string, unknown>) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-storm-text/80 flex items-center gap-2">
        <svg className="w-4 h-4 text-storm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span>
          <strong className="text-storm-text font-semibold">Plan — {count} step{count !== 1 ? 's' : ''}</strong>
          <span className="text-storm-muted/60 ml-1.5 text-xs">(view PLAN.md in the file tree)</span>
        </span>
      </p>
      {steerOptions && (
        <InlineSteerButtons options={steerOptions} onSteer={onSteer} disabled={disabled} />
      )}
    </div>
  )
}

/* ---------- Done Banner ---------- */

function DoneBanner({ status, text }: { status: string; text: string }) {
  const isCompleted = status === 'completed'
  return (
    <div className="flex items-center gap-2">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isCompleted ? 'bg-green-600/30' : 'bg-storm-border/60'}`}>
        {isCompleted ? (
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : (
          <svg className="w-3 h-3 text-storm-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
        )}
      </div>
      <span className={`text-sm font-medium ${isCompleted ? 'text-green-400' : 'text-storm-muted'}`}>
        <FormattedText text={text} />
      </span>
    </div>
  )
}

/* ---------- User Bubble ---------- */

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex items-start gap-2 justify-end animate-in">
      <div className="max-w-[70%] rounded-xl bg-storm-accent/15 border border-storm-accent/20 px-3.5 py-2">
        <FormattedText text={message.text} className="text-sm text-storm-text" />
      </div>
      <UserAvatar />
    </div>
  )
}

/* ---------- Avatars ---------- */

function UserAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-storm-accent/20 flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-storm-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  )
}

function AssistantAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-storm-accent/10 flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-storm-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    </div>
  )
}

/* ---------- Inline Steer Buttons ---------- */

const ACTION_COLORS: Record<string, string> = {
  approve: 'bg-green-600 hover:bg-green-700 text-white',
  redo: 'bg-yellow-600 hover:bg-yellow-700 text-white',
  regenerate: 'bg-blue-600 hover:bg-blue-700 text-white',
  retry: 'bg-yellow-600 hover:bg-yellow-700 text-white',
  skip: 'bg-storm-border hover:bg-storm-border/80 text-storm-text',
  stop: 'bg-red-600 hover:bg-red-700 text-white',
}

function InlineSteerButtons({
  options,
  onSteer,
  disabled,
}: {
  options: SteerOption[]
  onSteer: (action: string) => void
  disabled?: boolean
}) {
  const [clicked, setClicked] = useState<string | null>(null)

  const handle = (action: string) => {
    setClicked(action)
    onSteer(action)
  }

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {options.map((opt) => (
        <button
          key={opt.action}
          onClick={() => handle(opt.action)}
          disabled={disabled || clicked !== null}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            ACTION_COLORS[opt.action] || 'bg-storm-accent hover:bg-storm-accent-hover text-white'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Message Filter ---------- */

function isDisplayMessage(msg: ChatMessage): boolean {
  // Filter out old persisted step_start messages matching "**Step N:**"
  if (msg.role === 'assistant' && /^\*\*Step \d+/i.test(msg.text)) return false
  return true
}

/* ---------- Data Extraction ---------- */

function extractPlan(messages: ChatMessage[]): SubTask[] {
  for (const msg of messages) {
    if (msg.type === 'plan_turn') {
      const plan = msg.data?.plan as SubTask[] | undefined
      if (plan && plan.length > 0) return plan
    }
  }
  return []
}

function buildStepStates(messages: ChatMessage[], currentStep: number): StepState[] {
  const stepMap = new Map<number, StepState>()

  for (const msg of messages) {
    if (msg.type === 'step_turn') {
      const step = (msg.data?.step as number) || 0
      const success = (msg.data?.success as boolean) ?? true
      stepMap.set(step, {
        step,
        description: (msg.data?.description as string) || '',
        status: success ? 'completed' : 'failed',
        summary: (msg.data?.summary as string) || '',
        toolCalls: msg.data?.toolCalls as Record<string, unknown>[] | undefined,
      })
    } else if (msg.type === 'step_failure') {
      const step = (msg.data?.step as number) || 0
      stepMap.set(step, {
        step,
        description: (msg.data?.description as string) || '',
        status: 'failed',
        toolCalls: msg.data?.toolCalls as Record<string, unknown>[] | undefined,
        steerOptions: msg.data?.steerOptions as SteerOption[] | undefined,
      })
    }
  }

  const plan = extractPlan(messages)
  const result: StepState[] = []

  for (const p of plan) {
    const existing = stepMap.get(p.step)
    if (existing) {
      result.push({
        ...existing,
        description: existing.description || p.description,
      })
    } else if (p.step === currentStep && currentStep > 0) {
      result.push({ step: p.step, description: p.description, files: p.files, status: 'active' })
    } else {
      result.push({ step: p.step, description: p.description, files: p.files, status: 'pending' })
    }
  }

  return result
}

function mergeWithPlan(states: Record<number, StepState>, plan: SubTask[], currentStep: number): StepState[] {
  return plan.map((p) => {
    const existing = states[p.step]
    if (existing) {
      return { ...existing, description: existing.description || p.description }
    }
    if (p.step === currentStep && currentStep > 0) {
      return { step: p.step, description: p.description, files: p.files, status: 'active' }
    }
    return { step: p.step, description: p.description, files: p.files, status: 'pending' }
  })
}
