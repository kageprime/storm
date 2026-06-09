import { useState } from 'react'
import type { SubTask } from '../lib/api'
import type { SteerOption } from '../hooks/useAgentStream'
import { FormattedText } from './FormattedText'

export type StepState = {
  step: number
  description: string
  files?: string[]
  status: 'pending' | 'active' | 'completed' | 'failed'
  summary?: string
  toolCalls?: Record<string, unknown>[]
  steerOptions?: SteerOption[]
}

type Props = {
  plan: SubTask[]
  steps: StepState[]
  onSteer?: (action: string) => void
}

export function StepTimeline({ plan, steps, onSteer }: Props) {
  const allSteps = plan.map((p) => {
    const existing = steps.find((s) => s.step === p.step)
    return existing || { step: p.step, description: p.description, files: p.files, status: 'pending' as const }
  })

  return (
    <div className="bg-storm-surface/20 rounded-xl border border-storm-border/40">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-storm-border/30 flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-storm-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
        <span className="text-xs font-semibold text-storm-muted uppercase tracking-wider">Execution Steps</span>
        <span className="text-[10px] text-storm-muted/50 ml-auto">{allSteps.filter(s => s.status === 'completed').length}/{allSteps.length}</span>
      </div>

      {/* Steps */}
      <div className="px-4 py-3">
        <div className="relative ml-2">
          {allSteps.map((step, i) => (
            <StepPill
              key={step.step}
              step={step}
              isLast={i === allSteps.length - 1}
              onSteer={onSteer}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------- Tool Icons ---------- */

function toolIcon(tool: string): string {
  if (/read|view|cat/i.test(tool)) return '📖'
  if (/write|edit|create|patch|replace/i.test(tool)) return '✏️'
  if (/bash|shell|terminal|command|exec|run/i.test(tool)) return '💻'
  if (/grep|search|find|lookup/i.test(tool)) return '🔍'
  if (/delete|remove|unlink|rm/i.test(tool)) return '🗑️'
  if (/list|glob|readdir|ls/i.test(tool)) return '📂'
  if (/rename|move|mv/i.test(tool)) return '📎'
  return '⚙️'
}

/* ---------- Tool Call Row (Kimi-style) ---------- */

function ToolCallRow({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const tool = (data.tool as string) || ''
  const file = (data.file as string) || (data.path as string) || ''
  const input = (data.input as Record<string, unknown>) || {}
  const output = (data.output as string) || ''
  const isError = (data.status as string) === 'error'
  const title = (data.title as string) || ''
  const command = (input.command as string) || ''
  const shortInput = title || file || command || (input.file_path as string) || (input.path as string) || ''

  const isFileEdit = /write|edit|create|patch|replace/i.test(tool)
  const isBash = /bash|shell|terminal|command|exec|run/i.test(tool)
  const isRead = /read|view|cat/i.test(tool)

  return (
    <div className={`rounded-lg border text-[11px] overflow-hidden ${
      isError
        ? 'border-red-800/30 bg-red-900/10'
        : isFileEdit
          ? 'border-emerald-800/20 bg-emerald-900/8'
          : 'border-storm-border/30 bg-storm-bg/30'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-storm-surface/30 transition-colors"
      >
        {/* Icon */}
        <span className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] bg-storm-surface/50">
          {toolIcon(tool)}
        </span>

        {/* Tool name */}
        <span className={`text-xs font-semibold ${isError ? 'text-red-300' : isFileEdit ? 'text-emerald-300' : 'text-storm-text/80'}`}>
          {tool}
        </span>

        {/* File or command */}
        {shortInput && (
          <span className="text-storm-muted font-mono truncate flex-1 min-w-0 max-w-[200px]">
            {shortInput}
          </span>
        )}

        {/* Status */}
        <span className="flex-shrink-0 flex items-center gap-1 ml-auto">
          {isError ? (
            <span className="text-red-400 text-[10px] font-medium">failed</span>
          ) : (
            <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
          <svg className={`w-3 h-3 text-storm-muted/30 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-storm-border/20 px-2.5 py-2 space-y-2 font-mono">
          {Object.keys(input).length > 0 && (
            <div>
              <div className="text-[10px] text-storm-muted/50 mb-0.5 font-semibold uppercase tracking-wider">Input</div>
              <pre className="bg-storm-bg/80 rounded-lg p-2 text-storm-text/70 overflow-x-auto max-h-28 overflow-y-auto text-[10px] leading-relaxed">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output && (
            <div>
              <div className="text-[10px] text-storm-muted/50 mb-0.5 font-semibold uppercase tracking-wider">Output</div>
              <pre className="bg-storm-bg/80 rounded-lg p-2 text-storm-text/70 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- Step Pill ---------- */

function StepPill({
  step,
  isLast,
  onSteer,
}: {
  step: StepState
  isLast: boolean
  onSteer?: (action: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isPending = step.status === 'pending'
  const isActive = step.status === 'active'
  const isCompleted = step.status === 'completed'
  const isFailed = step.status === 'failed'
  const hasToolCalls = (step.toolCalls?.length ?? 0) > 0
  const canExpand = isCompleted || isFailed

  return (
    <div className="relative pb-3 last:pb-0">
      {/* Vertical connector line */}
      {!isLast && (
        <div
          className={`absolute left-[11px] top-4 bottom-0 w-px ${
            isCompleted ? 'bg-emerald-600/30' : 'bg-storm-border/15'
          }`}
        />
      )}

      <div className="flex items-start gap-3">
        {/* Status circle */}
        <div className="relative z-10 mt-0.5">
          {isActive ? (
            <div className="w-[22px] h-[22px] rounded-full bg-storm-accent flex items-center justify-center ring-2 ring-storm-accent/30">
              <svg className="w-3 h-3 text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
              </svg>
            </div>
          ) : isCompleted ? (
            <div className="w-[22px] h-[22px] rounded-full bg-emerald-600/25 flex items-center justify-center">
              <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          ) : isFailed ? (
            <div className="w-[22px] h-[22px] rounded-full bg-red-600/25 flex items-center justify-center">
              <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          ) : (
            <div className="w-[22px] h-[22px] rounded-full bg-storm-border/20 flex items-center justify-center">
              <span className="text-[10px] font-semibold text-storm-muted/30">{step.step}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Clickable step header */}
          <button
            onClick={() => canExpand && setExpanded(!expanded)}
            className={`w-full text-left ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className={`text-sm leading-snug ${
                  isPending
                    ? 'text-storm-muted/40'
                    : isFailed
                      ? 'text-red-300/90'
                      : 'text-storm-text'
                }`}>
                  <FormattedText text={step.description} />
                </div>
              </div>
              {/* Expand chevron for completed/failed steps */}
              {canExpand && (hasToolCalls || step.summary) && (
                <svg className={`w-3 h-3 text-storm-muted/30 mt-1 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              )}
            </div>
            {/* Summary — visible when collapsed */}
            {!expanded && step.summary && isCompleted && (
              <div className="text-xs text-storm-text/50 leading-relaxed mt-0.5">
                <FormattedText text={step.summary} />
              </div>
            )}
          </button>

          {/* Expanded content: tool calls + summary */}
          {expanded && (
            <div className="space-y-1.5">
              {step.summary && isCompleted && (
                <div className="text-xs text-storm-text/50 leading-relaxed">
                  <FormattedText text={step.summary} />
                </div>
              )}
              {hasToolCalls && (
                <div className="space-y-1">
                  {step.toolCalls!.map((tc, i) => (
                    <ToolCallRow key={(tc.callID as string) || i} data={tc} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Steer buttons for failed steps — always visible */}
          {isFailed && step.steerOptions && onSteer && (
            <div className="flex flex-wrap gap-1.5">
              {step.steerOptions.map((opt) => (
                <button
                  key={opt.action}
                  onClick={() => onSteer(opt.action)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    opt.action === 'redo' || opt.action === 'retry'
                      ? 'bg-yellow-600/15 text-yellow-400 hover:bg-yellow-600/25'
                      : opt.action === 'skip'
                        ? 'bg-storm-border/30 text-storm-muted hover:bg-storm-border/50'
                        : opt.action === 'stop'
                          ? 'bg-red-600/15 text-red-400 hover:bg-red-600/25'
                          : 'bg-storm-accent/15 text-storm-accent hover:bg-storm-accent/25'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
