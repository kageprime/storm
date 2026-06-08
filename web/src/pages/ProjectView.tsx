import { useState, useEffect, useRef, FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import type { Project } from '../lib/api'
import { useAgentStream } from '../hooks/useAgentStream'
import { ChatStream } from '../components/ChatStream'

export function ProjectView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [goalText, setGoalText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [goalId, setGoalId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { messages, goalStatus, currentStep, totalSteps, pendingSteer, steer } =
    useAgentStream(id || null, goalId)

  useEffect(() => {
    if (!id) return
    api.getProject(id).then((res) => setProject(res.project)).catch(() => navigate('/'))
  }, [id, navigate])

  async function handleSubmitGoal(e: FormEvent) {
    e.preventDefault()
    if (!id || !goalText.trim()) return
    setSubmitting(true)
    try {
      const res = await api.submitGoal(id, goalText.trim())
      setGoalId(res.goal.id)
      setGoalText('')
    } catch {
      // ignore
    } finally {
      setSubmitting(false)
    }
  }

  // When goal completes, reset so user can submit another
  useEffect(() => {
    if (goalStatus === 'completed' || goalStatus === 'failed' || goalStatus === 'cancelled') {
      setGoalId(null)
      setSubmitting(false)
    }
  }, [goalStatus])

  const isFinished = goalStatus === 'completed' || goalStatus === 'failed' || goalStatus === 'cancelled'

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
        </div>
        <div className="flex items-center gap-2 text-xs text-storm-muted">
          {project?.gitUrl && (
            <span className="font-mono">{project.gitUrl}</span>
          )}
          {project?.status && (
            <span
              className={`px-2 py-0.5 rounded-full ${
                project.status === 'ready'
                  ? 'bg-green-900/30 text-green-400'
                  : 'bg-blue-900/30 text-blue-400'
              }`}
            >
              {project.status}
            </span>
          )}
        </div>
      </div>

      {/* Chat area */}
      <ChatStream
        messages={messages}
        pendingSteer={pendingSteer}
        onSteer={steer}
        goalStatus={goalStatus}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />

      {/* Input bar */}
      <div className="border-t border-storm-border px-4 py-4 bg-storm-surface/50">
        <form onSubmit={handleSubmitGoal} className="max-w-3xl mx-auto flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            placeholder={isFinished ? 'Submit another goal...' : 'What should the agent do?'}
            disabled={submitting || (goalStatus !== null && !isFinished)}
            className="flex-1 bg-storm-bg border border-storm-border rounded-xl px-4 py-3 text-storm-text text-sm focus:outline-none focus:border-storm-accent transition-colors disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={submitting || !goalText.trim() || (goalStatus !== null && !isFinished)}
            className="bg-storm-accent hover:bg-storm-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-sm font-medium transition-colors"
          >
            {submitting ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
