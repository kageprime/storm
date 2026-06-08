import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../hooks/useAgentStream'
import { PlanDisplay } from './PlanDisplay'
import { SteeringButtons } from './SteeringButtons'

type Props = {
  messages: ChatMessage[]
  pendingSteer: { prompt: string; options: Array<{ label: string; action: string }> } | null
  failureSteer: { prompt: string; options: Array<{ label: string; action: string }> } | null
  onSteer: (action: string, payload?: Record<string, unknown>) => void
  goalStatus: string | null
  currentStep: number
  totalSteps: number
}

export function ChatStream({ messages, pendingSteer, failureSteer, onSteer, goalStatus, currentStep, totalSteps }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const isExecuting = goalStatus === 'executing'
  const isPlanning = goalStatus === 'planning'

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
      {/* Progress bar during execution */}
      {isExecuting && totalSteps > 0 && (
        <div className="sticky top-0 bg-storm-bg/95 backdrop-blur pb-3 z-10">
          <div className="flex items-center justify-between text-xs text-storm-muted mb-1">
            <span>
              Step {currentStep} of {totalSteps}
            </span>
            <span>{Math.round((currentStep / totalSteps) * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-storm-border rounded-full overflow-hidden">
            <div
              className="h-full bg-storm-accent rounded-full transition-all duration-500"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Stop button during execution */}
      {isExecuting && (
        <div className="flex justify-center">
          <button
            onClick={() => onSteer('stop')}
            className="px-3 py-1 text-xs text-red-400 border border-red-800/40 rounded-full hover:bg-red-900/20 transition-colors"
          >
            Stop execution
          </button>
        </div>
      )}

      {messages.length === 0 && (
        <div className="text-center text-storm-muted py-12">
          <p className="text-lg mb-2">Submit a goal to get started</p>
          <p className="text-sm">
            The agent will create a plan, then execute step by step autonomously after you approve.
          </p>
        </div>
      )}

      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} currentStep={currentStep} />
      ))}

      {/* Loading dots */}
      {isPlanning && (
        <div className="flex items-center gap-2 text-storm-muted text-sm py-2">
          <span>Planning</span>
          <span className="loading-dot">.</span>
          <span className="loading-dot">.</span>
          <span className="loading-dot">.</span>
        </div>
      )}
      {isExecuting && (
        <div className="flex items-center gap-2 text-storm-muted text-sm py-2">
          <span>Working</span>
          <span className="loading-dot">.</span>
          <span className="loading-dot">.</span>
          <span className="loading-dot">.</span>
        </div>
      )}

      {/* Plan approval buttons */}
      {pendingSteer && (
        <div className="py-2">
          <SteeringButtons
            options={pendingSteer.options}
            onSteer={(action) => onSteer(action)}
            disabled={isPlanning || isExecuting}
          />
        </div>
      )}

      {/* Failure steering buttons */}
      {failureSteer && (
        <div className="py-2">
          <SteeringButtons
            options={failureSteer.options}
            onSteer={(action) => onSteer(action)}
          />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

function MessageBubble({
  message,
  currentStep,
}: {
  message: ChatMessage
  currentStep: number
}) {
  const isUser = message.role === 'user'

  if (message.type === 'plan') {
    const plan = (message.data?.plan as Array<{ step: number; description: string; files: string[] }>) || []
    return (
      <div className="max-w-2xl">
        <p className="text-sm text-storm-text mb-2">{message.text}</p>
        <PlanDisplay plan={plan} currentStep={currentStep} />
      </div>
    )
  }

  const files = message.data?.files
  const fileList = Array.isArray(files) ? (files as string[]) : null

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
          isUser
            ? 'bg-storm-accent/20 text-storm-text border border-storm-accent/30'
            : message.type === 'error'
              ? 'bg-red-900/20 text-red-300 border border-red-800/40'
              : message.type === 'done'
                ? 'bg-green-900/20 text-green-300 border border-green-800/40'
                : 'bg-storm-surface text-storm-text border border-storm-border'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.text}</p>
        {fileList && fileList.length > 0 && (
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {fileList.map((f) => (
              <span
                key={f}
                className="text-xs px-1.5 py-0.5 rounded bg-storm-border/50 text-storm-muted font-mono"
              >
                {f}
              </span>
            ))}
          </div>
        )}
        <span className="text-[10px] text-storm-muted mt-1 block opacity-60">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}
