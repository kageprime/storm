import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, SteerOption } from '../hooks/useAgentStream'
import { PlanDisplay } from './PlanDisplay'

type Props = {
  messages: ChatMessage[]
  onSteer: (action: string, payload?: Record<string, unknown>) => void
  goalStatus: string | null
  currentStep: number
  totalSteps: number
}

export function ChatStream({ messages, onSteer, goalStatus, currentStep, totalSteps }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const isExecuting = goalStatus === 'executing'
  const isPlanning = goalStatus === 'planning'

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-3">
      {/* Progress bar during execution */}
      {isExecuting && totalSteps > 0 && (
        <div className="sticky top-0 bg-storm-bg/95 backdrop-blur pb-3 z-10">
          <div className="flex items-center justify-between text-xs text-storm-muted mb-1">
            <span>
              Step {currentStep} of {totalSteps}
            </span>
            <span>{Math.round(((currentStep - 1) / totalSteps) * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-storm-border rounded-full overflow-hidden">
            <div
              className="h-full bg-storm-accent rounded-full transition-all duration-500"
              style={{ width: `${((currentStep - 1) / totalSteps) * 100}%` }}
            />
          </div>
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

      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onSteer={onSteer}
          currentStep={currentStep}
          isLast={i === messages.length - 1}
          isExecuting={isExecuting}
          isPlanning={isPlanning}
        />
      ))}

      {/* Loading dots */}
      {isPlanning && (
        <div className="flex items-center gap-2 text-storm-muted text-sm py-2 ml-10">
          <span>Planning</span>
          <span className="loading-dot">.</span>
          <span className="loading-dot">.</span>
          <span className="loading-dot">.</span>
        </div>
      )}
      {isExecuting && (
        <div className="flex items-center gap-2 text-storm-muted text-sm py-2 ml-10">
          <span>Working</span>
          <span className="loading-dot">.</span>
          <span className="loading-dot">.</span>
          <span className="loading-dot">.</span>
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

      <div ref={bottomRef} />
    </div>
  )
}

/* ---------- Avatar ---------- */

function UserAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-storm-accent/25 flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-storm-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  )
}

function AssistantAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-storm-accent/15 flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-storm-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    </div>
  )
}

/* ---------- Message Bubble ---------- */

function MessageBubble({
  message,
  onSteer,
  currentStep,
  isLast,
  isExecuting,
  isPlanning,
}: {
  message: ChatMessage
  onSteer: (action: string, payload?: Record<string, unknown>) => void
  currentStep: number
  isLast: boolean
  isExecuting: boolean
  isPlanning: boolean
}) {
  if (message.role === 'user') {
    return (
      <div className="flex items-start gap-2 justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-storm-accent/20 border border-storm-accent/25 px-4 py-2.5">
          <p className="text-sm text-storm-text whitespace-pre-wrap">{message.text}</p>
        </div>
        <UserAvatar />
      </div>
    )
  }

  if (message.type === 'error') {
    return (
      <div className="flex items-start gap-2">
        <AssistantAvatar />
        <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-red-900/20 border border-red-800/40 px-4 py-2.5">
          <p className="text-sm text-red-300 whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    )
  }

  if (message.type === 'done') {
    return (
      <div className="flex items-start gap-2">
        <AssistantAvatar />
        <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-green-900/20 border border-green-800/40 px-4 py-2.5">
          <p className="text-sm text-green-300 whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    )
  }

  if (message.type === 'plan_turn') {
    const plan = (message.data?.plan || []) as Array<{ step: number; description: string; files: string[] }>
    const steerOptions = message.data?.steerOptions as SteerOption[] | undefined
    return (
      <div className="flex items-start gap-2">
        <AssistantAvatar />
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-storm-surface border border-storm-border px-4 py-3">
          <p className="text-sm text-storm-text mb-3">{message.text}</p>
          <PlanDisplay plan={plan} />
          {steerOptions && (
            <InlineSteerButtons options={steerOptions} onSteer={onSteer} disabled={isPlanning || isExecuting} />
          )}
        </div>
      </div>
    )
  }

  if (message.type === 'step_turn') {
    const toolCalls = (message.data?.toolCalls || []) as Record<string, unknown>[]
    const summary = (message.data?.summary as string) || ''
    return (
      <div className="flex items-start gap-2">
        <AssistantAvatar />
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-storm-surface border border-storm-border px-4 py-3">
          <p className="text-sm text-storm-text font-medium mb-2">{message.text}</p>
          {toolCalls.length > 0 && (
            <div className="mb-2 space-y-0.5">
              {toolCalls.map((tc, i) => (
                <ToolCallItem key={i} data={tc} />
              ))}
            </div>
          )}
          {summary && (
            <p className="text-sm text-storm-text/90 whitespace-pre-wrap leading-relaxed">{summary}</p>
          )}
        </div>
      </div>
    )
  }

  if (message.type === 'step_failure') {
    const toolCalls = (message.data?.toolCalls || []) as Record<string, unknown>[]
    const steerOptions = message.data?.steerOptions as SteerOption[] | undefined
    return (
      <div className="flex items-start gap-2">
        <AssistantAvatar />
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-red-900/10 border border-red-800/30 px-4 py-3">
          <p className="text-sm text-storm-text font-medium mb-2">{message.text}</p>
          {toolCalls.length > 0 && (
            <div className="mb-2 space-y-0.5">
              {toolCalls.map((tc, i) => (
                <ToolCallItem key={i} data={tc} />
              ))}
            </div>
          )}
          <p className="text-sm text-red-300 mb-2">This step failed. What would you like to do?</p>
          {steerOptions && (
            <InlineSteerButtons options={steerOptions} onSteer={onSteer} />
          )}
        </div>
      </div>
    )
  }

  // fallback for system messages (user_message relayed from backend)
  return (
    <div className="flex items-start gap-2">
      <AssistantAvatar />
      <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-storm-surface border border-storm-border px-4 py-2.5">
        <p className="text-sm text-storm-text whitespace-pre-wrap">{message.text}</p>
      </div>
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

/* ---------- Tool Call Item ---------- */

function toolIcon(tool: string): string {
  if (tool.startsWith('FileRead') || tool.startsWith('Read')) return '📖'
  if (tool.startsWith('FileWrite') || tool.startsWith('Write') || tool.startsWith('Edit')) return '✏️'
  if (tool.startsWith('Bash') || tool.startsWith('Shell') || tool.startsWith('Terminal')) return '💻'
  if (tool.startsWith('Grep') || tool.startsWith('Search') || tool.startsWith('Find')) return '🔍'
  if (tool.startsWith('FileDelete') || tool.startsWith('Delete')) return '🗑️'
  if (tool.startsWith('List') || tool.startsWith('Glob')) return '📂'
  return '⚙️'
}

function shortInput(input: Record<string, unknown>): string {
  const val = input.command || input.path || input.file || input.pattern || input.query || ''
  return typeof val === 'string' ? val.slice(0, 120) : ''
}

function inputLabel(input: Record<string, unknown>): string {
  if (input.command) return 'command'
  if (input.path) return 'path'
  if (input.file) return 'file'
  if (input.pattern) return 'pattern'
  if (input.query) return 'query'
  if (input.content !== undefined) return 'content'
  return ''
}

function ToolCallItem({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const tool = (data.tool as string) || ''
  const input = (data.input as Record<string, unknown>) || {}
  const output = (data.output as string) || ''
  const status = (data.status as string) || ''
  const title = (data.title as string) || tool
  const file = (data.file as string) || ''
  const isError = status === 'error'

  return (
    <div
      className={`rounded-lg px-2.5 py-1 text-xs border ${
        isError
          ? 'bg-red-900/10 border-red-800/20'
          : 'bg-storm-bg/50 border-storm-border/40'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left"
      >
        <span>{toolIcon(tool)}</span>
        <span className="font-medium text-storm-text/80">{title}</span>
        {file && <span className="font-mono text-storm-muted/70 truncate max-w-[200px]">{file}</span>}
        {isError ? (
          <span className="text-red-400 ml-auto">failed</span>
        ) : (
          <span className="text-green-400/70 ml-auto">done</span>
        )}
        <span className="text-storm-muted/50">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 border-t border-storm-border/30 pt-1">
          {shortInput(input) && (
            <div>
              <span className="text-storm-muted/60">{inputLabel(input)}: </span>
              <span className="text-storm-text/80">{shortInput(input)}</span>
            </div>
          )}
          {output && (
            <div>
              <span className="text-storm-muted/60">result: </span>
              <span className="text-storm-text/70 whitespace-pre-wrap">{output.slice(0, 300)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
