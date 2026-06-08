import { EventEmitter } from 'node:events'
import { v4 as uuid } from 'uuid'
import { getDb, saveDb } from '../db/index.js'
import { openCodeManager } from './manager.js'
import { executeStep, type ExecutorEvent } from './executor.js'
import { PLAN_PROMPT, parsePlanResponse, type SubTask } from './planner.js'

export type GoalStatus = 'planning' | 'awaiting_approval' | 'executing' | 'steering' | 'completed' | 'failed' | 'cancelled'

export type GoalEvent = {
  type: 'status_change' | 'plan_ready' | 'step_start' | 'step_progress' | 'step_complete' | 'tool_call' | 'file_edit' | 'user_message' | 'steering_needed' | 'error' | 'done'
  goalId: string
  projectId: string
  data: Record<string, unknown>
  timestamp: number
}

type GoalState = {
  id: string
  projectId: string
  status: GoalStatus
  goalText: string
  plan: SubTask[]
  currentStep: number
  context: string[]
  error: string | null
}

/**
 * Orchestrator manages the full agent loop lifecycle for a single goal.
 * Plan requires user approval. Once approved, steps auto-continue.
 * Users can send messages (appended to context) or stop at any time.
 * On step failure, user intervention is requested.
 */
class Orchestrator extends EventEmitter {
  private goals = new Map<string, GoalState>()

  private saveMessage(goalId: string, role: string, content: string, metadata?: Record<string, unknown>): void {
    const db = getDb()
    db.run(
      'INSERT INTO goal_messages (id, goal_id, role, content, metadata_json) VALUES (?, ?, ?, ?, ?)',
      [uuid(), goalId, role, content, metadata ? JSON.stringify(metadata) : null]
    )
    saveDb()
  }

  async submitGoal(goalId: string, projectId: string, goalText: string, sandboxPath: string): Promise<void> {
    const state: GoalState = {
      id: goalId,
      projectId,
      status: 'planning',
      goalText,
      plan: [],
      currentStep: 0,
      context: [],
      error: null,
    }

    this.goals.set(goalId, state)

    this.emit('event', {
      type: 'status_change',
      goalId,
      projectId,
      data: { status: 'planning', message: 'Analyzing your goal and creating a plan...' },
      timestamp: Date.now(),
    })

    this.saveMessage(goalId, 'system', `**Goal:** ${goalText}`)
    this.saveMessage(goalId, 'system', 'Analyzing your goal and creating a plan...')

    try {
      const client = await openCodeManager.getOrCreate(sandboxPath)

      const sessionRes = await client.session.create({
        body: { title: goalText },
        query: { directory: sandboxPath },
      })

      const sessionData = sessionRes.data as { id?: string } | undefined
      if (!sessionData?.id) throw new Error('Failed to create session')

      // --- PLAN ---
      const planResult = await client.session.prompt({
        path: { id: sessionData.id },
        body: {
          parts: [{ type: 'text', text: `${PLAN_PROMPT}\n${goalText}` }],
          model: { providerID: 'opencode', modelID: 'deepseek-v4-flash-free' },
        },
        query: { directory: sandboxPath },
      })

      const planData = planResult.data as { parts?: Array<{ type?: string; text?: string }> }
      const planText = planData?.parts?.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n') ?? ''

      const plan = await parsePlanResponse(planText)
      state.plan = plan

      // Save plan to DB
      const db = getDb()
      db.run(
        'UPDATE goals SET plan_json = ?, status = ?, total_steps = ? WHERE id = ?',
        [JSON.stringify(plan), 'awaiting_approval', plan.length, goalId]
      )
      saveDb()

      state.status = 'awaiting_approval'

      this.emit('event', {
        type: 'plan_ready',
        goalId,
        projectId,
        data: { plan, totalSteps: plan.length },
        timestamp: Date.now(),
      })

      this.saveMessage(goalId, 'assistant', `I've created a plan with ${plan.length} steps.`, { plan })

      this.emit('event', {
        type: 'steering_needed',
        goalId,
        projectId,
        data: {
          prompt: 'Here is my plan. Shall I proceed?',
          options: [
            { label: 'Approve', action: 'approve' },
            { label: 'Regenerate plan', action: 'regenerate' },
          ],
        },
        timestamp: Date.now(),
      })

      this.saveMessage(goalId, 'system', 'Here is my plan. Shall I proceed?', {
        options: [
          { label: 'Approve', action: 'approve' },
          { label: 'Regenerate plan', action: 'regenerate' },
        ],
      })
    } catch (err) {
      state.status = 'failed'
      state.error = err instanceof Error ? err.message : 'Unknown error'

      const db = getDb()
      db.run('UPDATE goals SET status = ?, error = ? WHERE id = ?', ['failed', state.error, goalId])
      saveDb()

      this.emit('event', {
        type: 'error',
        goalId,
        projectId,
        data: { message: state.error },
        timestamp: Date.now(),
      })

      this.saveMessage(goalId, 'system', `❌ Error: ${state.error}`)
    }
  }

  async handleSteer(goalId: string, action: string, payload?: Record<string, unknown>): Promise<void> {
    const state = this.goals.get(goalId)
    if (!state) throw new Error('Goal not found')

    if (action === 'message') {
      const text = payload?.text as string
      if (!text) throw new Error('Message text is required')
      state.context.push(`## User message\n${text}`)
      this.saveMessage(goalId, 'user', text, { action: 'message' })
      this.emit('event', {
        type: 'user_message',
        goalId: state.id,
        projectId: state.projectId,
        data: { text },
        timestamp: Date.now(),
      })
      return
    }

    const db2 = getDb()
    const projectResult2 = db2.exec('SELECT sandbox_path FROM projects WHERE id = ?', [state.projectId])
    const sandboxPath2 = projectResult2[0]?.values?.[0]?.[0] as string
    if (!sandboxPath2) throw new Error('Project sandbox not found')

    if (action === 'approve' && state.status === 'awaiting_approval') {
      state.status = 'executing'
      db2.run('UPDATE goals SET status = ? WHERE id = ?', ['executing', goalId])
      saveDb()
      this.saveMessage(goalId, 'user', 'Approved — proceed with the plan.', { action: 'approve' })
      this.executeNextStep(state, sandboxPath2).catch((err) => {
        console.error('Step execution failed:', err)
      })
      return
    }

    if (action === 'regenerate' && state.status === 'awaiting_approval') {
      db2.run('UPDATE goals SET status = ? WHERE id = ?', ['planning', goalId])
      saveDb()
      this.saveMessage(goalId, 'user', 'Regenerate the plan.', { action: 'regenerate' })
      await this.submitGoal(state.id, state.projectId, state.goalText, sandboxPath2)
      return
    }

    if (action === 'stop') {
      state.status = 'cancelled'
      const db3 = getDb()
      db3.run('UPDATE goals SET status = ? WHERE id = ?', ['cancelled', goalId])
      saveDb()

      this.saveMessage(goalId, 'user', 'Stop execution.', { action: 'stop' })
      this.saveMessage(goalId, 'system', '🏁 Goal cancelled by user.')

      this.emit('event', {
        type: 'done',
        goalId: state.id,
        projectId: state.projectId,
        data: { status: 'cancelled', message: 'Goal cancelled by user' },
        timestamp: Date.now(),
      })
      return
    }

    // Actions below require 'steering' (failure) state
    if (state.status !== 'steering') {
      throw new Error(`Action '${action}' not valid in state '${state.status}'`)
    }

    const db3 = getDb()
    const projectResult = db3.exec('SELECT sandbox_path FROM projects WHERE id = ?', [state.projectId])
    const sandboxPath = projectResult[0]?.values?.[0]?.[0] as string
    if (!sandboxPath) throw new Error('Project sandbox not found')

    if (action === 'redo') {
      this.saveMessage(goalId, 'user', 'Retry step.', { action: 'redo' })
      state.status = 'executing'
      db3.run('UPDATE goals SET status = ? WHERE id = ?', ['executing', goalId])
      saveDb()
      await this.executeNextStep(state, sandboxPath)
    } else if (action === 'skip') {
      this.saveMessage(goalId, 'user', 'Skip step.', { action: 'skip' })
      state.status = 'executing'
      state.currentStep++
      db3.run('UPDATE goals SET status = ?, current_step = ? WHERE id = ?', ['executing', state.currentStep, goalId])
      saveDb()
      await this.executeNextStep(state, sandboxPath)
    } else {
      throw new Error(`Action '${action}' not valid in state '${state.status}'`)
    }
  }

  private async executeNextStep(state: GoalState, sandboxPath: string): Promise<void> {
    if (state.currentStep >= state.plan.length) {
      state.status = 'completed'
      const db = getDb()
      db.run('UPDATE goals SET status = ?, current_step = ? WHERE id = ?', ['completed', state.currentStep, state.id])
      saveDb()

      this.saveMessage(state.id, 'system', '🏁 All steps completed successfully.')

      this.emit('event', {
        type: 'done',
        goalId: state.id,
        projectId: state.projectId,
        data: { status: 'completed', message: 'All steps completed successfully' },
        timestamp: Date.now(),
      })

      await openCodeManager.release(sandboxPath)
      return
    }

    const step = state.plan[state.currentStep]
    const displayStep = step.step

    this.emit('event', {
      type: 'step_start',
      goalId: state.id,
      projectId: state.projectId,
      data: { step: displayStep, description: step.description, files: step.files },
      timestamp: Date.now(),
    })

    this.saveMessage(state.id, 'assistant', `**Step ${displayStep}:** ${step.description}`, {
      step: displayStep,
      files: step.files,
    })

    const client = await openCodeManager.getOrCreate(sandboxPath)

    const result = await executeStep(
      client,
      sandboxPath,
      step.description,
      state.context.join('\n'),
      (event: ExecutorEvent) => {
        const eventType = event.type === 'tool_call' || event.type === 'file_edit' ? event.type : 'step_progress'
        this.emit('event', {
          type: eventType,
          goalId: state.id,
          projectId: state.projectId,
          data: event.data,
          timestamp: event.timestamp,
        })
      },
    )
    state.context.push(`## Step ${displayStep}: ${step.description}\n${result.summary}`)

    // Advance to next step in plan
    state.currentStep++
    const db = getDb()
    db.run('UPDATE goals SET current_step = ? WHERE id = ?', [state.currentStep, state.id])
    saveDb()

    this.emit('event', {
      type: 'step_complete',
      goalId: state.id,
      projectId: state.projectId,
      data: {
        step: displayStep,
        description: step.description,
        success: result.success,
        summary: result.summary,
      },
      timestamp: Date.now(),
    })

    if (result.success) {
      this.saveMessage(state.id, 'assistant', `✅ **Step ${displayStep} complete:** ${result.summary}`, {
        step: displayStep,
        success: true,
      })
      // Auto-continue to next step
      await this.executeNextStep(state, sandboxPath)
    } else {
      state.status = 'steering'
      const db2 = getDb()
      db2.run('UPDATE goals SET status = ? WHERE id = ?', ['steering', state.id])
      saveDb()

      this.saveMessage(state.id, 'system', `Step ${displayStep} failed. What would you like to do?`, {
        options: [
          { label: 'Retry', action: 'redo' },
          { label: 'Skip step', action: 'skip' },
          { label: 'Stop', action: 'stop' },
        ],
      })

      this.emit('event', {
        type: 'steering_needed',
        goalId: state.id,
        projectId: state.projectId,
        data: {
          prompt: `Step ${displayStep} failed. What would you like to do?`,
          options: [
            { label: 'Retry', action: 'redo' },
            { label: 'Skip step', action: 'skip' },
            { label: 'Stop', action: 'stop' },
          ],
        },
        timestamp: Date.now(),
      })
    }
  }

  subscribe(goalId: string, listener: (event: GoalEvent) => void): () => void {
    const handler = (event: GoalEvent) => {
      if (event.goalId === goalId) {
        listener(event)
      }
    }

    this.on('event', handler)

    return () => {
      this.off('event', handler)
    }
  }

  getState(goalId: string): GoalState | undefined {
    return this.goals.get(goalId)
  }
}

export const orchestrator = new Orchestrator()
