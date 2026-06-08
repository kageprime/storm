import { EventEmitter } from 'node:events'
import { getDb, saveDb } from '../db/index.js'
import { openCodeManager } from './manager.js'
import { executeStep, type ExecutorEvent } from './executor.js'
import { PLAN_PROMPT, parsePlanResponse, type SubTask } from './planner.js'

export type GoalStatus = 'planning' | 'awaiting_approval' | 'executing' | 'steering' | 'completed' | 'failed' | 'cancelled'

export type GoalEvent = {
  type: 'status_change' | 'plan_ready' | 'step_start' | 'step_progress' | 'step_complete' | 'steering_needed' | 'error' | 'done'
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
 * Uses an EventEmitter to broadcast events to SSE subscribers.
 */
class Orchestrator extends EventEmitter {
  private goals = new Map<string, GoalState>()

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
    }
  }

  async handleSteer(goalId: string, action: string, _payload?: Record<string, unknown>): Promise<void> {
    const state = this.goals.get(goalId)
    if (!state) throw new Error('Goal not found')

    const db = getDb()
    const projectResult = db.exec('SELECT sandbox_path FROM projects WHERE id = ?', [state.projectId])
    const sandboxPath = projectResult[0]?.values?.[0]?.[0] as string
    if (!sandboxPath) throw new Error('Project sandbox not found')

    if (action === 'approve' && state.status === 'awaiting_approval') {
      state.status = 'executing'
      state.currentStep = 0

      db.run('UPDATE goals SET status = ?, current_step = 0 WHERE id = ?', ['executing', goalId])
      saveDb()

      this.executeNextStep(state, sandboxPath).catch((err) => {
        console.error('Step execution failed:', err)
      })
    } else if (action === 'regenerate' && state.status === 'awaiting_approval') {
      state.status = 'planning'
      db.run('UPDATE goals SET status = ? WHERE id = ?', ['planning', goalId])
      saveDb()
      await this.submitGoal(state.id, state.projectId, state.goalText, sandboxPath)
    } else if (action === 'continue' && state.status === 'steering') {
      state.status = 'executing'
      this.executeNextStep(state, sandboxPath).catch((err) => {
        console.error('Step execution failed:', err)
      })
    } else if (action === 'redo' && state.status === 'steering') {
      state.status = 'executing'
      const dbR = getDb()
      dbR.run('UPDATE goals SET status = ? WHERE id = ?', ['executing', goalId])
      saveDb()
      this.executeNextStep(state, sandboxPath).catch((err) => {
        console.error('Step execution failed:', err)
      })
    } else if (action === 'stop') {
      state.status = 'cancelled'
      db.run('UPDATE goals SET status = ? WHERE id = ?', ['cancelled', goalId])
      saveDb()

      this.emit('event', {
        type: 'done',
        goalId: state.id,
        projectId: state.projectId,
        data: { status: 'cancelled', message: 'Goal cancelled by user' },
        timestamp: Date.now(),
      })
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
      saveDb()

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
    // currentStep is 0-indexed, step.step is 1-indexed
    const displayStep = step.step

    this.emit('event', {
      type: 'step_start',
      goalId: state.id,
      projectId: state.projectId,
      data: { step: step.step, description: step.description, files: step.files },
      timestamp: Date.now(),
    })

    const client = await openCodeManager.getOrCreate(sandboxPath)

    const result = await executeStep(
      client,
      sandboxPath,
      step.description,
      state.context.join('\n'),
      (event: ExecutorEvent) => {
        this.emit('event', {
          type: 'step_progress',
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

    const db2 = getDb()
    if (result.success) {
      if (state.currentStep >= state.plan.length) {
        state.status = 'steering'
        db2.run('UPDATE goals SET status = ? WHERE id = ?', ['steering', state.id])
        saveDb()
        this.emit('event', {
          type: 'steering_needed',
          goalId: state.id,
          projectId: state.projectId,
          data: {
            prompt: 'All steps completed. Review the results?',
            options: [
              { label: 'Done', action: 'continue' },
              { label: 'Stop', action: 'stop' },
            ],
          },
          timestamp: Date.now(),
        })
      } else {
        state.status = 'steering'
        const db3 = getDb()
        db3.run('UPDATE goals SET status = ? WHERE id = ?', ['steering', state.id])
        saveDb()
        this.emit('event', {
          type: 'steering_needed',
          goalId: state.id,
          projectId: state.projectId,
          data: {
            prompt: `Step ${state.currentStep + 1} complete. Continue to step ${state.currentStep + 2}?`,
            options: [
              { label: 'Continue', action: 'continue' },
              { label: 'Redo this step', action: 'redo' },
              { label: 'Stop', action: 'stop' },
            ],
          },
          timestamp: Date.now(),
        })
      }
    } else {
      state.status = 'steering'
      const db4 = getDb()
      db4.run('UPDATE goals SET status = ? WHERE id = ?', ['steering', state.id])
      saveDb()
      this.emit('event', {
        type: 'steering_needed',
        goalId: state.id,
        projectId: state.projectId,
        data: {
          prompt: `Step ${state.currentStep + 1} failed. What would you like to do?`,
          options: [
            { label: 'Retry', action: 'redo' },
            { label: 'Skip', action: 'continue' },
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
