import { useState, useEffect, useRef, FormEvent } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api'
import type { Project } from '../lib/api'
import type { Goal } from '../lib/api'
import { useAgentStream } from '../hooks/useAgentStream'
import { ChatStream } from '../components/ChatStream'
import { RightPanel } from '../components/RightPanel'
import { Group, Panel, Separator } from 'react-resizable-panels'

export function ProjectView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [project, setProject] = useState<Project | null>(null)
  const [goalText, setGoalText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [goalId, setGoalId] = useState<string | null>(() => searchParams.get('goal') || null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { messages, goalStatus, currentStep, totalSteps, steer, fileChangeCount, addMessage, agentLogs, lastHtmlFile, stepStates } =
    useAgentStream(id || null, goalId)

  useEffect(() => {
    if (!id) return
    api.getProject(id).then((res) => setProject(res.project)).catch(() => navigate('/'))
  }, [id, navigate])

  // Load goals + sync/auto-select goal from URL
  useEffect(() => {
    if (!id) return
    const urlGoal = searchParams.get('goal')
    if (urlGoal) {
      setGoalId(urlGoal)
      return
    }
    // No goal in URL — fetch goals and auto-select latest
    api.listGoals(id).then((res) => {
      setGoals(res.goals)
      const latest = res.goals[0]
      if (latest) {
        setGoalId(latest.id)
        setSearchParams({ goal: latest.id }, { replace: true })
      }
    }).catch(() => {})
  }, [id, searchParams, setSearchParams])

  // Refresh file tree when files change (step completes)
  useEffect(() => {
    if (fileChangeCount > 0) {
      setRefreshKey((k) => k + 1)
    }
  }, [fileChangeCount])

  async function handleSubmitGoal(e: FormEvent) {
    e.preventDefault()
    if (!id || !goalText.trim()) return
    setSubmitting(true)
    const text = goalText.trim()
    addMessage({ role: 'user', text, type: 'user_message', timestamp: Date.now() })
    try {
      const res = await api.submitGoal(id, text)
      setGoalId(res.goal.id)
      setSearchParams({ goal: res.goal.id }, { replace: true })
      setGoalText('')
    } catch {
      // ignore
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault()
    if (!id || !goalText.trim()) return

    if (!goalId) {
      await handleSubmitGoal(e)
      return
    }

    if (goalStatus === 'executing' || goalStatus === 'planning') {
      steer('message', { text: goalText.trim() })
      setGoalText('')
      return
    }

    if (goalStatus === 'completed' || goalStatus === 'failed' || goalStatus === 'cancelled') {
      setGoalId(null)
      setSearchParams({}, { replace: true })
      await handleSubmitGoal(e)
      return
    }

    // waiting for approval, steering, etc — just send as message
    steer('message', { text: goalText.trim() })
    setGoalText('')
  }

  const isActive = goalStatus === 'executing' || goalStatus === 'planning'

  return (
    <div className="h-[calc(100vh-57px)] flex flex-col">
      {/* Project header */}
      <div className="border-b border-storm-border/60 px-6 py-2.5 flex items-center justify-between bg-storm-surface/30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="text-storm-muted/50 hover:text-storm-text transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <h2 className="text-sm font-medium text-storm-text truncate">
            {project?.name || 'Loading...'}
          </h2>
          {goalStatus && goalStatus !== 'completed' && goalStatus !== 'failed' && goalStatus !== 'cancelled' && (
            <div className="flex items-center gap-1.5 text-[11px] text-storm-muted/70">
              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-storm-accent animate-pulse' : 'bg-storm-muted/40'}`} />
              <span className="capitalize">{goalStatus.replace('_', ' ')}</span>
              {totalSteps > 0 && <span>· {currentStep}/{totalSteps}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {/* Goal history button */}
          {goals.length > 1 && (
            <GoalHistory
              goals={goals}
              currentGoalId={goalId}
              onSelect={(gid) => {
                setGoalId(gid)
                setSearchParams({ goal: gid }, { replace: true })
              }}
            />
          )}
          {project?.gitUrl && (
            <span className="font-mono text-xs text-storm-muted/50 truncate max-w-[160px] hidden sm:inline">
              {project.gitUrl}
            </span>
          )}
        </div>
      </div>

      {/* Body: Resizable split */}
      <div className="flex-1 flex overflow-hidden">
        <Group orientation="horizontal">
          {/* Left Pane: Chat & Input */}
          <Panel defaultSize={60} minSize={25} className="flex flex-col min-w-0 bg-storm-bg">
            <div className="flex-1 overflow-hidden flex flex-col">
              <ChatStream
                messages={messages}
                onSteer={steer}
                goalStatus={goalStatus}
                currentStep={currentStep}
                totalSteps={totalSteps}
                liveStepStates={stepStates}
              />
            </div>
            
            {/* Input bar */}
            <div className="border-t border-storm-border px-4 py-4 bg-storm-surface/50 flex-shrink-0">
              <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex gap-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={goalText}
                  onChange={(e) => setGoalText(e.target.value)}
                  placeholder={
                    !goalId
                      ? 'What should the agent do?'
                      : isActive
                        ? 'Send a message to the agent...'
                        : 'Submit another goal...'
                  }
                  disabled={submitting}
                  autoFocus
                  className="flex-1 bg-storm-bg border border-storm-border rounded-xl px-4 py-3 text-storm-text text-sm focus:outline-none focus:border-storm-accent transition-colors disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={submitting || !goalText.trim()}
                  className="bg-storm-accent hover:bg-storm-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-sm font-medium transition-colors"
                >
                  {submitting ? '...' : goalId && isActive ? 'Send' : 'Go'}
                </button>
              </form>
            </div>
          </Panel>

          <Separator className="w-1 bg-storm-border hover:bg-storm-accent/50 transition-colors cursor-col-resize z-10" />

          {/* Right Pane: Files/Preview */}
          <Panel defaultSize={40} minSize={30} className="flex flex-col min-w-0">
            <RightPanel
              projectId={id || null}
              refreshKey={refreshKey}
              agentLogs={agentLogs}
              previewPath={lastHtmlFile}
              goalStatus={goalStatus}
            />
          </Panel>
        </Group>
      </div>
    </div>
  )
}

/* ---------- Goal History Dropdown ---------- */

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-green-400',
  failed: 'text-red-400',
  cancelled: 'text-storm-muted/50',
  planning: 'text-storm-accent',
  awaiting_approval: 'text-yellow-400',
  executing: 'text-storm-accent',
  steering: 'text-yellow-400',
}

function GoalHistory({
  goals,
  currentGoalId,
  onSelect,
}: {
  goals: Goal[]
  currentGoalId: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const current = goals.find(g => g.id === currentGoalId)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-storm-muted/60 hover:text-storm-muted transition-colors whitespace-nowrap"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="hidden sm:inline truncate max-w-[120px]">
          {current ? current.goalText.slice(0, 30) : 'History'}
        </span>
        <span className="text-[10px]">{goals.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-storm-surface border border-storm-border rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto">
          {goals.map((g) => {
            const isActive = g.id === currentGoalId
            return (
              <button
                key={g.id}
                onClick={() => { onSelect(g.id); setOpen(false) }}
                className={`w-full text-left px-3 py-2.5 border-b border-storm-border/40 last:border-0 transition-colors ${
                  isActive
                    ? 'bg-storm-accent/10'
                    : 'hover:bg-storm-border/20'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[10px] font-medium capitalize ${STATUS_COLORS[g.status] || 'text-storm-muted'}`}>
                    {g.status}
                  </span>
                  {g.totalSteps > 0 && (
                    <span className="text-[10px] text-storm-muted/50">
                      {g.currentStep}/{g.totalSteps}
                    </span>
                  )}
                </div>
                <p className="text-xs text-storm-text/80 truncate">{g.goalText}</p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
