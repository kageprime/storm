import { useState, useEffect, useRef, FormEvent } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api'
import type { Project } from '../lib/api'
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
  const [refreshKey, setRefreshKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { messages, goalStatus, currentStep, totalSteps, steer, fileChangeCount, addMessage, agentLogs, lastHtmlFile } =
    useAgentStream(id || null, goalId)

  useEffect(() => {
    if (!id) return
    api.getProject(id).then((res) => setProject(res.project)).catch(() => navigate('/'))
  }, [id, navigate])

  // Sync goalId from URL params (handles manual URL edits)
  useEffect(() => {
    const urlGoal = searchParams.get('goal')
    setGoalId(urlGoal || null)
  }, [searchParams])

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
      <div className="border-b border-storm-border px-6 py-3 flex items-center justify-between bg-storm-surface/50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-storm-muted hover:text-storm-text transition-colors"
          >
            ←
          </button>
          <h2 className="text-storm-text font-medium truncate">
            {project?.name || 'Loading...'}
          </h2>
          {isActive && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-storm-accent/20 text-storm-accent animate-pulse">
              Running
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-storm-muted">
          {project?.gitUrl && (
            <span className="font-mono">{project.gitUrl}</span>
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
            />
          </Panel>
        </Group>
      </div>
    </div>
  )
}
