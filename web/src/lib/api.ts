const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('storm_token')
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`)
  }

  return data as T
}

// --- Auth ---

export type AuthResponse = {
  token: string
  user: { id: string; email: string }
}

export function register(email: string, password: string) {
  return request<AuthResponse>('POST', '/auth/register', { email, password })
}

export function login(email: string, password: string) {
  return request<AuthResponse>('POST', '/auth/login', { email, password })
}

// --- Projects ---

export type Project = {
  id: string
  name: string
  gitUrl: string | null
  status: string
  sandboxPath?: string
  createdAt: string
  updatedAt: string
}

export type GoalsList = {
  goals: Array<{
    id: string
    goalText: string
    status: string
    currentStep: number
    totalSteps: number
    createdAt: string
    updatedAt: string
  }>
}

export function listProjects() {
  return request<{ projects: Project[] }>('GET', '/projects')
}

export function createProject(name: string, gitUrl?: string) {
  return request<{ project: Project }>('POST', '/projects', { name, gitUrl })
}

export function getProject(id: string) {
  return request<{ project: Project }>('GET', `/projects/${id}`)
}

export function deleteProject(id: string) {
  return request<{ success: boolean }>('DELETE', `/projects/${id}`)
}

// --- Goals ---

export type SubTask = {
  step: number
  description: string
  files: string[]
}

export type Goal = {
  id: string
  projectId: string
  goalText: string
  plan: SubTask[] | null
  status: string
  currentStep: number
  totalSteps: number
  error: string | null
  createdAt: string
  updatedAt: string
}

export function submitGoal(projectId: string, goalText: string) {
  return request<{ goal: Goal }>(
    'POST',
    `/projects/${projectId}/goals`,
    { goalText }
  )
}

export function getGoal(projectId: string, goalId: string) {
  return request<{ goal: Goal }>(
    'GET',
    `/projects/${projectId}/goals/${goalId}`
  )
}

export function listGoals(projectId: string) {
  return request<{ goals: Goal[] }>(
    'GET',
    `/projects/${projectId}/goals`
  )
}

export function steerGoal(
  projectId: string,
  goalId: string,
  action: string,
  payload?: Record<string, unknown>
) {
  return request<{ success: boolean }>(
    'POST',
    `/projects/${projectId}/goals/${goalId}/steer`,
    { action, payload }
  )
}

// --- Files ---

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FileNode[]
}

export function listFiles(projectId: string) {
  return request<{ files: FileNode[] }>('GET', `/projects/${projectId}/files`)
}

export function getFileContent(projectId: string, filePath: string): Promise<Response> {
  const token = getToken()
  return fetch(`${BASE}/projects/${projectId}/files/${filePath}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

// --- SSE ---

export type GoalEvent = {
  type: 'status_change' | 'plan_ready' | 'step_start' | 'step_progress' | 'step_complete' | 'steering_needed' | 'user_message' | 'error' | 'done'
  goalId: string
  projectId: string
  data: Record<string, unknown>
  timestamp: number
}

export function connectGoalStream(
  projectId: string,
  goalId: string,
  onEvent: (event: GoalEvent) => void
): () => void {
  const token = getToken()
  const controller = new AbortController()

  async function connect() {
    try {
      const res = await fetch(
        `${BASE}/projects/${projectId}/goals/${goalId}/stream`,
        {
          headers: {
            Authorization: `Bearer ${token!}`,
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        }
      )

      if (!res.ok) {
        setTimeout(connect, 3000)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as GoalEvent
              onEvent(event)
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setTimeout(connect, 3000)
      }
    }
  }

  connect()
  return () => controller.abort()
}
