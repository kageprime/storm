import { useState, useEffect, useCallback } from 'react'
import * as api from '../lib/api'
import type { FileNode } from '../lib/api'

type Props = {
  projectId: string | null
  refreshKey: number // increment to trigger refresh
}

export function PreviewPanel({ projectId, refreshKey }: Props) {
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
        // binary response
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
              <span className="text-xs opacity-60">📄</span>
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
          <iframe
            srcDoc={content || ''}
            className="w-full h-full border-0 bg-white"
            title="Preview"
            sandbox="allow-scripts"
          />
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
    <div className="h-full flex flex-col border-l border-storm-border bg-storm-surface">
      {/* File tree */}
      <div className="border-b border-storm-border px-3 py-2">
        <span className="text-xs font-medium text-storm-muted uppercase tracking-wider">Files</span>
      </div>
      <div className="overflow-y-auto flex-shrink-0 max-h-[40%] py-1">
        {tree.length === 0 ? (
          <p className="text-xs text-storm-muted px-3 py-4 text-center">No files yet</p>
        ) : (
          renderTree(tree)
        )}
      </div>

      {/* Preview */}
      <div className="border-b border-storm-border px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-medium text-storm-muted uppercase tracking-wider">Preview</span>
        {selectedPath && (
          <span className="text-xs text-storm-muted font-mono truncate ml-2">{selectedPath}</span>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {renderPreview()}
      </div>
    </div>
  )
}
