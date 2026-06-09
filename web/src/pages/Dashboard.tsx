import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import type { Project } from '../lib/api'

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  async function loadProjects() {
    try {
      setLoadError(null)
      const res = await api.listProjects()
      setProjects(res.projects)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load projects'
      setLoadError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const res = await api.createProject(name.trim(), gitUrl.trim() || undefined)
      setProjects((prev) => [res.project, ...prev])
      setShowCreate(false)
      setName('')
      setGitUrl('')
      navigate(`/projects/${res.project.id}`)
    } catch {
      // ignore
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this project and its sandbox?')) return
    try {
      await api.deleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-storm-text">Projects</h1>
          <p className="text-storm-muted text-sm mt-1">
            Each project has an isolated sandbox for the agent to work in.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-storm-accent hover:bg-storm-accent-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          New project
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-storm-surface border border-storm-border rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold text-storm-text mb-4">
              New project
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-storm-muted mb-1">
                  Project name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full bg-storm-bg border border-storm-border rounded-lg px-3 py-2 text-storm-text text-sm focus:outline-none focus:border-storm-accent"
                  placeholder="My awesome project"
                />
              </div>
              <div>
                <label className="block text-sm text-storm-muted mb-1">
                  Git URL <span className="text-storm-muted/60">(optional)</span>
                </label>
                <input
                  type="url"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  className="w-full bg-storm-bg border border-storm-border rounded-lg px-3 py-2 text-storm-text text-sm focus:outline-none focus:border-storm-accent"
                  placeholder="https://github.com/user/repo.git"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-storm-muted hover:text-storm-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !name.trim()}
                  className="bg-storm-accent hover:bg-storm-accent-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project list */}
      {loading ? (
        <div className="text-center text-storm-muted py-12">Loading...</div>
      ) : loadError ? (
        <div className="text-center py-12 border-2 border-dashed border-red-800/40 rounded-xl">
          <p className="text-sm text-red-400 mb-1">Failed to load projects</p>
          <p className="text-xs text-red-400/60">{loadError}</p>
          <button
            onClick={loadProjects}
            className="mt-3 px-3 py-1.5 text-xs text-storm-accent border border-storm-accent/30 rounded-lg hover:bg-storm-accent/10 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center text-storm-muted py-12 border-2 border-dashed border-storm-border rounded-xl">
          <p className="text-lg mb-2">No projects yet</p>
          <p className="text-sm">Create a project to start working with the agent.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className="bg-storm-surface border border-storm-border rounded-xl px-5 py-4 flex items-center justify-between cursor-pointer hover:border-storm-accent/50 transition-all group"
            >
              <div className="flex-1 min-w-0">
                <h3 className="text-storm-text font-medium truncate">
                  {project.name}
                </h3>
                <p className="text-storm-muted text-sm mt-0.5">
                  {project.gitUrl ? (
                    <span className="font-mono text-xs">{project.gitUrl}</span>
                  ) : (
                    'Empty project'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    project.status === 'ready'
                      ? 'bg-green-900/30 text-green-400'
                      : project.status === 'cloning'
                        ? 'bg-blue-900/30 text-blue-400'
                        : 'bg-storm-border text-storm-muted'
                  }`}
                >
                  {project.status}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(project.id)
                  }}
                  className="text-storm-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-sm"
                  title="Delete project"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
