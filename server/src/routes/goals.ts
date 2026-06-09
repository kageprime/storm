import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { getDb, saveDb } from '../db/index.js'
import { authMiddleware, Variables } from '../auth/middleware.js'
import { orchestrator, type GoalEvent } from '../agent/orchestrator.js'

const goals = new Hono<{ Variables: Variables }>()

goals.use('*', authMiddleware)

goals.post('/:projectId/goals', async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('projectId')
  const { goalText } = await c.req.json()

  if (!goalText) {
    c.status(400)
    return c.json({ error: 'Goal text is required', code: 'VALIDATION_ERROR' })
  }

  const db = getDb()

  const projResult = db.exec(
    'SELECT id, sandbox_path, daytona_opencode_url FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  )

  const projRow = projResult[0]?.values?.[0]
  if (!projRow) {
    c.status(404)
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' })
  }

  const sandboxPath = projRow[1] as string | null
  const daytonaOpencodeUrl = projRow[2] as string | null
  const goalId = uuid()

  db.run(
    'INSERT INTO goals (id, project_id, goal_text, status) VALUES (?, ?, ?, ?)',
    [goalId, projectId, goalText, 'planning']
  )
  saveDb()

  // Fire-and-forget: process the goal in the background
  orchestrator.submitGoal(goalId, projectId, goalText, sandboxPath, daytonaOpencodeUrl).catch((err) => {
    console.error('Goal processing failed:', err)
    const db = getDb()
    db.run('UPDATE goals SET status = ?, error = ? WHERE id = ?', ['failed', err instanceof Error ? err.message : String(err), goalId])
    saveDb()
  })

  return c.json({ goal: { id: goalId, projectId, goalText, status: 'planning' } }, 202)
})

goals.get('/:projectId/goals/:goalId/stream', async (c) => {
  const { userId } = c.get('user')
  const goalId = c.req.param('goalId')

  const db = getDb()
  const result = db.exec(
    `SELECT g.id FROM goals g
     JOIN projects p ON g.project_id = p.id
     WHERE g.id = ? AND p.user_id = ?`,
    [goalId, userId]
  )

  if (!result[0]?.values?.length) {
    c.status(404)
    return c.json({ error: 'Goal not found', code: 'NOT_FOUND' })
  }

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const unsubscribe = orchestrator.subscribe(goalId, (event: GoalEvent) => {
    const line = `data: ${JSON.stringify(event)}\n\n`
    writer.write(encoder.encode(line)).catch(() => {})
  })

  c.req.raw.signal.addEventListener('abort', () => {
    unsubscribe()
    writer.close().catch(() => {})
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

goals.post('/:projectId/goals/:goalId/steer', async (c) => {
  const { userId } = c.get('user')
  const goalId = c.req.param('goalId')
  const { action, payload } = await c.req.json()

  const db = getDb()
  const result = db.exec(
    `SELECT g.id FROM goals g
     JOIN projects p ON g.project_id = p.id
     WHERE g.id = ? AND p.user_id = ?`,
    [goalId, userId]
  )

  if (!result[0]?.values?.length) {
    c.status(404)
    return c.json({ error: 'Goal not found', code: 'NOT_FOUND' })
  }

  try {
    await orchestrator.handleSteer(goalId, action, payload)
    return c.json({ success: true })
  } catch (err) {
    c.status(400)
    return c.json({
      error: err instanceof Error ? err.message : 'Steering failed',
      code: 'STEER_ERROR',
    })
  }
})

goals.get('/:projectId/goals/:goalId', async (c) => {
  const { userId } = c.get('user')
  const goalId = c.req.param('goalId')

  const db = getDb()
  const result = db.exec(
    `SELECT g.id, g.project_id, g.goal_text, g.plan_json, g.status, g.current_step, g.total_steps, g.error, g.created_at, g.updated_at
     FROM goals g
     JOIN projects p ON g.project_id = p.id
     WHERE g.id = ? AND p.user_id = ?`,
    [goalId, userId]
  )

  const row = result[0]?.values?.[0]
  if (!row) {
    c.status(404)
    return c.json({ error: 'Goal not found', code: 'NOT_FOUND' })
  }

  const [id, projectId, goalText, planJson, status, currentStep, totalSteps, error, createdAt, updatedAt] = row as string[]

  return c.json({
    goal: {
      id,
      projectId,
      goalText,
      plan: planJson ? JSON.parse(planJson) : null,
      status,
      currentStep: parseInt(currentStep || '0', 10),
      totalSteps: parseInt(totalSteps || '0', 10),
      error,
      createdAt,
      updatedAt,
    },
  })
})

goals.get('/:projectId/goals/:goalId/messages', async (c) => {
  const { userId } = c.get('user')
  const goalId = c.req.param('goalId')

  const db = getDb()
  const result = db.exec(
    `SELECT g.id FROM goals g
     JOIN projects p ON g.project_id = p.id
     WHERE g.id = ? AND p.user_id = ?`,
    [goalId, userId]
  )

  if (!result[0]?.values?.length) {
    c.status(404)
    return c.json({ error: 'Goal not found', code: 'NOT_FOUND' })
  }

  const msgResult = db.exec(
    `SELECT role, content, metadata_json, created_at
     FROM goal_messages
     WHERE goal_id = ?
     ORDER BY created_at ASC`,
    [goalId]
  )

  const messages = (msgResult[0]?.values || []).map((row: unknown[]) => {
    const [role, content, metadataJson, createdAt] = row as string[]
    return {
      role,
      content,
      metadata: metadataJson ? JSON.parse(metadataJson) : null,
      timestamp: new Date(createdAt).getTime(),
    }
  })

  return c.json({ messages })
})

goals.get('/:projectId/goals', async (c) => {
  const { userId } = c.get('user')
  const projectId = c.req.param('projectId')

  const db = getDb()
  const result = db.exec(
    `SELECT g.id, g.goal_text, g.status, g.current_step, g.total_steps, g.created_at, g.updated_at
     FROM goals g
     JOIN projects p ON g.project_id = p.id
     WHERE g.project_id = ? AND p.user_id = ?
     ORDER BY g.created_at DESC`,
    [projectId, userId]
  )

  const rows = result[0]?.values || []
  const list = rows.map((row: unknown[]) => {
    const [id, goalText, status, currentStep, totalSteps, createdAt, updatedAt] = row as string[]
    return { id, goalText, status, currentStep: parseInt(currentStep || '0', 10), totalSteps: parseInt(totalSteps || '0', 10), createdAt, updatedAt }
  })

  return c.json({ goals: list })
})

export default goals
