import { useState, useEffect, useRef, useCallback } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import * as api from '../lib/api'
import type { FileNode } from '../lib/api'
import type { AgentLogEntry } from '../hooks/useAgentStream'

type Tab = 'files' | 'preview' | 'agent'

type Props = {
  projectId: string | null
  refreshKey: number
  agentLogs: AgentLogEntry[]
  previewPath: string | null
}

export function RightPanel({ projectId, refreshKey, agentLogs, previewPath }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('agent')

  // Auto-switch to preview tab when a new preview file is available
  useEffect(() => {
    if (previewPath) {
      setActiveTab('preview')
    }
  }, [previewPath])

  return (
    <div className="h-full w-full flex flex-col bg-storm-surface">
      {/* Tab bar */}
      <div className="flex border-b border-storm-border text-sm flex-shrink-0">
        {([
          { id: 'files' as Tab, label: 'Code' },
          { id: 'preview' as Tab, label: 'Preview' },
          { id: 'agent' as Tab, label: 'Agent Logs' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors ${
              activeTab === tab.id
                ? 'text-storm-accent border-b-2 border-storm-accent bg-storm-accent/5'
                : 'text-storm-muted hover:text-storm-text hover:bg-storm-border/20'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'files' && (
          <FilesTab projectId={projectId} refreshKey={refreshKey} />
        )}
        {activeTab === 'preview' && (
          <PreviewTab projectId={projectId} filePath={previewPath} />
        )}
        {activeTab === 'agent' && (
          <AgentTab logs={agentLogs} />
        )}
      </div>
    </div>
  )
}

/* ───────── Files Tab ───────── */

function FilesTab({
  projectId,
  refreshKey,
}: {
  projectId: string | null
  refreshKey: number
}) {
  const [tree, setTree] = useState<FileNode[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentType, setContentType] = useState<'text' | 'html' | 'image' | 'binary' | null>(null)
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const loadTree = useCallback(async () => {
    if (!projectId) return
    try {
      const res = await api.listFiles(projectId)
      setTree(res.files)
    } catch {
      // project might not have sandbox yet
    }
  }, [projectId])

  useEffect(() => {
    loadTree()
  }, [loadTree, refreshKey])

  async function selectFile(node: FileNode) {
    if (node.type === 'dir') {
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(node.path)) next.delete(node.path)
        else next.add(node.path)
        return next
      })
      return
    }

    if (!projectId) return
    setSelectedPath(node.path)
    setLoading(true)

    try {
      const res = await api.getFileContent(projectId, node.path)
      const header = res.headers.get('Content-Type') || ''

      if (header.includes('text/plain')) {
        const text = await res.text()
        setContent(text)
        const ext = node.name.toLowerCase().split('.').pop()
        if (ext === 'html' || ext === 'htm') {
          setContentType('html')
        } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext || '')) {
          setContentType('image')
        } else {
          setContentType('text')
        }
      } else {
        const data = await res.json()
        if (data.type === 'binary') {
          setContent(data.data)
          const ext = node.name.toLowerCase().split('.').pop()
          if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext || '')) {
            setContentType('image')
          } else {
            setContentType('binary')
          }
        }
      }
    } catch {
      setContent('Failed to load file')
      setContentType('text')
    } finally {
      setLoading(false)
    }
  }

  function renderTree(nodes: FileNode[], depth = 0): React.ReactNode {
    return nodes.map((node) => {
      const isCollapsed = collapsed.has(node.path)
      const isSelected = node.path === selectedPath

      return (
        <div key={node.path}>
          <button
            onClick={() => selectFile(node)}
            className={`w-full text-left px-2 py-1 text-sm rounded transition-colors flex items-center gap-1.5 ${
              isSelected
                ? 'bg-storm-accent/20 text-storm-text'
                : 'hover:bg-storm-border/50 text-storm-muted hover:text-storm-text'
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
          >
            {node.type === 'dir' ? (
              <span className="text-xs opacity-60">{isCollapsed ? '▶' : '▼'}</span>
            ) : (
              <span className="text-xs opacity-60">{'📄'}</span>
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {node.type === 'dir' && !isCollapsed && node.children && (
            <div>{renderTree(node.children, depth + 1)}</div>
          )}
        </div>
      )
    })
  }

  function renderPreview() {
    if (!selectedPath) {
      return (
        <div className="flex items-center justify-center h-full text-storm-muted text-sm">
          Select a file to preview
        </div>
      )
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center h-full text-storm-muted text-sm">
          Loading...
        </div>
      )
    }

    switch (contentType) {
      case 'html':
        return (
          <pre className="text-sm text-storm-text font-mono p-4 overflow-auto whitespace-pre-wrap h-full">
            {content}
          </pre>
        )
      case 'image':
        return (
          <div className="flex items-center justify-center h-full p-4">
            <img
              src={`data:image/*;base64,${content}`}
              alt={selectedPath}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        )
      case 'text':
        return (
          <pre className="text-sm text-storm-text font-mono p-4 overflow-auto whitespace-pre-wrap h-full">
            {content}
          </pre>
        )
      default:
        return (
          <div className="flex items-center justify-center h-full text-storm-muted text-sm">
            Binary file — cannot preview
          </div>
        )
    }
  }

  return (
    <div className="h-full flex flex-col">
      <Group orientation="horizontal">
        <Panel defaultSize={25} minSize={15} className="flex flex-col border-r border-storm-border">
          <div className="border-b border-storm-border px-3 py-2 flex-shrink-0">
            <span className="text-xs font-medium text-storm-muted uppercase tracking-wider">Explorer</span>
          </div>
          <div className="overflow-y-auto flex-1 py-1 bg-storm-surface">
            {tree.length === 0 ? (
              <p className="text-xs text-storm-muted px-3 py-4 text-center">No files yet</p>
            ) : (
              renderTree(tree)
            )}
          </div>
        </Panel>
        
        <Separator className="w-1 bg-storm-border hover:bg-storm-accent/50 transition-colors cursor-col-resize z-10 -ml-[1px]" />
        
        <Panel defaultSize={75} minSize={30} className="flex flex-col min-w-0">
          <div className="border-b border-storm-border px-3 py-2 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-medium text-storm-muted uppercase tracking-wider">Editor</span>
            {selectedPath && (
              <span className="text-xs text-storm-muted font-mono truncate ml-2">{selectedPath}</span>
            )}
          </div>
          <div className="flex-1 overflow-auto min-w-0 bg-storm-bg">
            {renderPreview()}
          </div>
        </Panel>
      </Group>
    </div>
  )
}

/* ───────── Preview Tab ───────── */

// ─── Fullscreen SVG icons ───

function ExpandIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
    </svg>
  )
}

/* ───────── Preview Frame ───────── */

function PreviewFrame({ src, projectId }: { src: string; projectId: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [fs, setFs] = useState(false)

  useEffect(() => {
    function onFsChange() { setFs(document.fullscreenElement === wrapperRef.current) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function toggle() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      wrapperRef.current?.requestFullscreen().catch(() => {})
    }
  }

  return (
    <div ref={wrapperRef} className="relative w-full h-full flex flex-col">
      <button
        onClick={toggle}
        className="absolute top-2 right-2 z-20 p-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-colors"
        title={fs ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {fs ? <CollapseIcon /> : <ExpandIcon />}
      </button>
      <iframe
        src={src}
        className="flex-1 w-full border-0 bg-white"
        title="Preview"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  )
}

/* ───────── Preview Tab ───────── */

function PreviewTab({
  projectId,
  filePath,
}: {
  projectId: string | null
  filePath: string | null
}) {
  const [devReady, setDevReady] = useState(false)
  const [starting, setStarting] = useState(false)

  const url = projectId
    ? filePath
      ? api.getPreviewUrl(projectId, filePath)
      : `/api/preview/${projectId}`
    : null

  useEffect(() => {
    if (!projectId || url) return
    setStarting(true)
    fetch(`/api/dev-server/${projectId}/start`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('storm_token') },
    })
      .then((r) => r.json().then((d) => { if (d.url) setDevReady(true) }))
      .catch(() => {})
      .finally(() => setStarting(false))
  }, [projectId, url])

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full text-storm-muted text-sm">
        Loading project...
      </div>
    )
  }

  if (url) {
    return <PreviewFrame src={url} projectId={projectId} />
  }

  if (devReady) {
    return <PreviewFrame src={`/api/preview/${projectId}`} projectId={projectId} />
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-storm-muted text-sm gap-4">
      <p>No preview file selected</p>
      <p className="text-xs">Start the dev server or select an HTML file from the Code tab</p>
      {starting ? (
        <div className="flex items-center gap-2 text-storm-accent text-xs">
          <span className="animate-spin">&#9696;</span> Starting dev server...
        </div>
      ) : (
        <button
          onClick={() => {
            setStarting(true)
            fetch(`/api/dev-server/${projectId}/start`, {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + localStorage.getItem('storm_token') },
            })
              .then((r) => r.json().then((d) => { if (d.url) setDevReady(true) }))
              .catch(() => {})
              .finally(() => setStarting(false))
          }}
          className="px-4 py-2 text-xs rounded-lg bg-storm-accent hover:bg-storm-accent-hover text-white transition-colors"
        >
          Start Dev Server
        </button>
      )}
    </div>
  )
}

/* ───────── Agent Tab ───────── */

function toolIconFromType(type: string): string {
  if (type.startsWith('FileRead') || type.startsWith('Read')) return '📖'
  if (type.startsWith('FileWrite') || type.startsWith('Write') || type.startsWith('Edit')) return '✏️'
  if (type.startsWith('Bash') || type.startsWith('Shell') || type.startsWith('Terminal')) return '💻'
  if (type.startsWith('Grep') || type.startsWith('Search') || type.startsWith('Find')) return '🔍'
  if (type.startsWith('FileDelete') || type.startsWith('Delete')) return '🗑️'
  if (type.startsWith('List') || type.startsWith('Glob')) return '📂'
  return '⚙️'
}

function shortVal(input: Record<string, unknown>): string {
  const val = input.command || input.path || input.file || input.pattern || input.query || ''
  return typeof val === 'string' ? val.slice(0, 120) : ''
}

function AgentTab({ logs }: { logs: AgentLogEntry[] }) {
  const bottomRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-storm-muted text-sm">
        Waiting for agent activity...
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-1.5 font-mono text-xs">
      {logs.map((entry) => {
        switch (entry.type) {
          case 'step_start':
            return (
              <div key={entry.id} className="border-l-2 border-storm-accent/50 pl-3 py-1 text-storm-text">
                <span className="text-storm-accent font-semibold">▶ Step {entry.data.step as string}</span>
                <span className="text-storm-muted ml-2">{entry.data.description as string}</span>
              </div>
            )
          case 'tool_call': {
            const tool = (entry.data.tool as string) || ''
            const input = (entry.data.input as Record<string, unknown>) || {}
            const file = (entry.data.file as string) || (entry.data.path as string) || ''
            return (
              <div key={entry.id} className="border-l-2 border-storm-border/40 pl-3 py-0.5 text-storm-text/80">
                <span className="mr-1">{toolIconFromType(tool)}</span>
                <span className="text-storm-text/60">{tool}</span>
                {file && <span className="text-storm-muted ml-1 truncate">{file}</span>}
                {shortVal(input) && <span className="text-storm-muted/60 ml-1">— {shortVal(input)}</span>}
              </div>
            )
          }
          case 'file_edit': {
            const file = (entry.data.file as string) || (entry.data.path as string) || ''
            const summary = (entry.data.summary as string) || ''
            return (
              <div key={entry.id} className="border-l-2 border-green-600/40 pl-3 py-0.5 text-green-400/80">
                <span>✏️ {file}</span>
                {summary && <span className="text-green-400/60 ml-1">— {summary}</span>}
              </div>
            )
          }
          case 'step_complete': {
            const success = entry.data.success as boolean
            const step = entry.data.step as string
            const desc = entry.data.description as string
            return (
              <div
                key={entry.id}
                className={`border-l-2 pl-3 py-1 ${
                  success ? 'border-green-600/50 text-green-400/90' : 'border-red-600/50 text-red-400/90'
                }`}
              >
                {success ? '✓' : '✗'} Step {step}: {desc}
              </div>
            )
          }
          case 'error':
            return (
              <div key={entry.id} className="border-l-2 border-red-600/50 pl-3 py-1 text-red-400">
                ✗ {(entry.data.message as string) || 'Error'}
              </div>
            )
          default:
            return null
        }
      })}
      <div ref={bottomRef} />
    </div>
  )
}
