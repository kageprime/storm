import { EventEmitter } from 'node:events'
import { v4 as uuid } from 'uuid'
import { getDb, saveDb } from '../db/index.js'
import { openCodeManager } from './manager.js'
import { executeStep, type ExecutorEvent } from './executor.js'
import { PLAN_PROMPT, parsePlanResponse, CODING_CONVENTIONS, promptForAgent, type SubTask } from './planner.js'
import { writeSandboxFile, readSandboxFile, getProjectSandboxInfo } from '../sandbox.js'

export type GoalStatus = 'planning' | 'awaiting_approval' | 'executing' | 'steering' | 'completed' | 'failed' | 'cancelled'

export type GoalEvent = {
  type: 'status_change' | 'plan_ready' | 'step_start' | 'step_progress' | 'step_complete' | 'tool_call' | 'file_edit' | 'user_message' | 'steering_needed' | 'error' | 'done' | 'parallel_start' | 'parallel_complete'
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
  failedSteps: number[]
  context: string[]
  error: string | null
  sandboxPath: string | null
  daytonaOpencodeUrl: string | null
}

const PLAN_FILENAME = 'PLAN.md'

function buildPlanMd(plan: SubTask[], completedSteps: Set<number>, failedSteps: Set<number>): string {
  const lines = ['# Plan', '']
  for (const s of plan) {
    if (failedSteps.has(s.step)) {
      lines.push(`- [x] ~~**Step ${s.step}:** ${s.description}~~ *(failed)*`)
    } else if (completedSteps.has(s.step)) {
      lines.push(`- [x] **Step ${s.step}:** ${s.description}`)
    } else {
      lines.push(`- [ ] **Step ${s.step}:** ${s.description}`)
    }
    if (s.files?.length) {
      lines.push(`  - Files: ${s.files.join(', ')}`)
    }
  }
  lines.push('', '---', '*Last updated: ' + new Date().toISOString() + '*')
  return lines.join('\n')
}

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

  async submitGoal(goalId: string, projectId: string, goalText: string, sandboxPath: string | null, daytonaOpencodeUrl?: string | null): Promise<void> {
    const state: GoalState = {
      id: goalId,
      projectId,
      status: 'planning',
      goalText,
      plan: [],
      currentStep: 0,
      failedSteps: [],
      context: [],
      error: null,
      sandboxPath,
      daytonaOpencodeUrl: daytonaOpencodeUrl || null,
    }

    this.goals.set(goalId, state)

    this.emit('event', {
      type: 'status_change',
      goalId,
      projectId,
      data: { status: 'planning', message: 'Analyzing your goal and creating a plan...' },
      timestamp: Date.now(),
    })

    this.saveMessage(goalId, 'user', goalText)
    this.saveMessage(goalId, 'system', 'Analyzing your goal and creating a plan...')

    try {
      const baseUrl = state.daytonaOpencodeUrl || undefined
      const client = await openCodeManager.getOrCreate(projectId, baseUrl)
      const query = sandboxPath ? { directory: sandboxPath } : {}

      const sessionRes = await client.session.create({
        body: { title: goalText },
        query,
      })

      const sessionData = sessionRes.data as { id?: string } | undefined
      if (!sessionData?.id) throw new Error('Failed to create session')

      // --- PLAN ---
      const planResult = await client.session.prompt({
        path: { id: sessionData.id },
        body: {
          parts: [{ type: 'text', text: `${PLAN_PROMPT}\n${goalText}` }],
          model: { providerID: 'opencode', modelID: 'deepseek-v4-flash-free' },
          system: CODING_CONVENTIONS,
        },
        query,
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

      // Write PLAN.md to sandbox
      const sandboxInfo = getProjectSandboxInfo(projectId)
      if (sandboxInfo) {
        await writeSandboxFile(
          sandboxInfo.sandboxPath,
          sandboxInfo.daytonaSandboxId,
          PLAN_FILENAME,
          buildPlanMd(plan, new Set(), new Set()),
        )
      }

      state.status = 'awaiting_approval'

      this.emit('event', {
        type: 'plan_ready',
        goalId,
        projectId,
        data: { plan, totalSteps: plan.length },
        timestamp: Date.now(),
      })

      const steerOptions = [
        { label: 'Approve', action: 'approve' },
        { label: 'Regenerate plan', action: 'regenerate' },
      ]

      this.saveMessage(goalId, 'assistant', `I've created a plan with ${plan.length} steps.`, { plan, steerOptions })

      this.emit('event', {
        type: 'steering_needed',
        goalId,
        projectId,
        data: {
          prompt: 'Here is my plan. Shall I proceed?',
          options: steerOptions,
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

    if (action === 'approve' && state.status === 'awaiting_approval') {
      state.status = 'executing'
      const db2 = getDb()
      db2.run('UPDATE goals SET status = ? WHERE id = ?', ['executing', goalId])
      saveDb()
      this.saveMessage(goalId, 'user', 'Approved — proceed with the plan.', { action: 'approve' })
      this.executeNextStep(state).catch((err) => {
        console.error('Step execution failed:', err)
      })
      return
    }

    if (action === 'regenerate' && state.status === 'awaiting_approval') {
      const db2 = getDb()
      db2.run('UPDATE goals SET status = ? WHERE id = ?', ['planning', goalId])
      saveDb()
      this.saveMessage(goalId, 'user', 'Regenerate the plan.', { action: 'regenerate' })
      await this.submitGoal(state.id, state.projectId, state.goalText, state.sandboxPath, state.daytonaOpencodeUrl)
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

    if (action === 'redo') {
      this.saveMessage(goalId, 'user', 'Retry step.', { action: 'redo' })
      state.status = 'executing'
      const db3 = getDb()
      db3.run('UPDATE goals SET status = ? WHERE id = ?', ['executing', goalId])
      saveDb()
      await this.executeNextStep(state)
    } else if (action === 'skip') {
      this.saveMessage(goalId, 'user', 'Skip step.', { action: 'skip' })
      state.status = 'executing'
      state.currentStep++
      const db3 = getDb()
      db3.run('UPDATE goals SET status = ?, current_step = ? WHERE id = ?', ['executing', state.currentStep, goalId])
      saveDb()
      await this.executeNextStep(state)
    } else {
      throw new Error(`Action '${action}' not valid in state '${state.status}'`)
    }
  }

  private canRunParallel(a: SubTask, b: SubTask): boolean {
    if (a.agent !== b.agent) return true
    if (a.files?.length && b.files?.length) {
      const fileSet = new Set(a.files)
      return !b.files.some(f => fileSet.has(f))
    }
    return false
  }

  private formBatch(state: GoalState): SubTask[] {
    const batch = [state.plan[state.currentStep]]
    for (let i = state.currentStep + 1; i < state.plan.length; i++) {
      const next = state.plan[i]
      const canAllRun = batch.every(b => this.canRunParallel(b, next))
      if (canAllRun) {
        batch.push(next)
      } else {
        break
      }
    }
    return batch
  }

  private async updatePlanMd(state: GoalState): Promise<void> {
    const sandboxInfo = getProjectSandboxInfo(state.projectId)
    if (!sandboxInfo) return

    const failedSteps = new Set(state.failedSteps)
    const completedSteps = new Set<number>()
    for (let i = 1; i <= state.currentStep; i++) {
      if (!failedSteps.has(i)) completedSteps.add(i)
    }

    await writeSandboxFile(
      sandboxInfo.sandboxPath,
      sandboxInfo.daytonaSandboxId,
      PLAN_FILENAME,
      buildPlanMd(state.plan, completedSteps, failedSteps),
    )
  }

  private async executeStepBatch(state: GoalState): Promise<void> {
    const batch = this.formBatch(state)
    const isParallel = batch.length > 1

    if (isParallel) {
      this.emit('event', {
        type: 'parallel_start',
        goalId: state.id,
        projectId: state.projectId,
        data: {
          steps: batch.map(s => ({ step: s.step, description: s.description, agent: s.agent, files: s.files })),
        },
        timestamp: Date.now(),
      })
    }

    for (const step of batch) {
      this.emit('event', {
        type: 'step_start',
        goalId: state.id,
        projectId: state.projectId,
        data: { step: step.step, description: step.description, files: step.files },
        timestamp: Date.now(),
      })

    }

    const baseUrl = state.daytonaOpencodeUrl || undefined
    const client = await openCodeManager.getOrCreate(state.projectId, baseUrl)

    const contextBase = state.context.join('\n')

    const stepResults = await Promise.all(
      batch.map(async (step) => {
        const result = await executeStep(
          client,
          state.sandboxPath,
          step.description,
          contextBase,
          (event: ExecutorEvent) => {
            const eventType = event.type === 'tool_call' || event.type === 'file_edit' ? event.type : 'step_progress'
            this.emit('event', {
              type: eventType,
              goalId: state.id,
              projectId: state.projectId,
              data: { ...event.data, step: step.step, agent: step.agent },
              timestamp: event.timestamp,
            })
          },
          step.agent,
          step.agent ? promptForAgent(step.agent) : undefined,
        )
        return { step, result }
      }),
    )

    // Process results in order
    let anyFailed = false
    let firstFailed: SubTask | null = null

    for (const { step, result } of stepResults) {
      state.context.push(`## Step ${step.step}: ${step.description}\n${result.summary}`)

      state.currentStep++

      this.emit('event', {
        type: 'step_complete',
        goalId: state.id,
        projectId: state.projectId,
        data: {
          step: step.step,
          description: step.description,
          success: result.success,
          summary: result.summary,
        },
        timestamp: Date.now(),
      })

      if (result.success) {
        this.saveMessage(state.id, 'assistant', `✅ **Step ${step.step} complete:** ${result.summary}`, {
          step: step.step,
          description: step.description,
          success: true,
          summary: result.summary,
        })
      } else {
        anyFailed = true
        firstFailed ??= step
        state.failedSteps.push(step.step)
        this.saveMessage(state.id, 'assistant', `❌ **Step ${step.step} failed:** ${result.summary}`, {
          step: step.step,
          description: step.description,
          success: false,
          summary: result.summary,
        })
      }

      await this.updatePlanMd(state)
    }

    const db = getDb()
    db.run('UPDATE goals SET current_step = ? WHERE id = ?', [state.currentStep, state.id])
    saveDb()

    if (isParallel) {
      this.emit('event', {
        type: 'parallel_complete',
        goalId: state.id,
        projectId: state.projectId,
        data: {
          steps: stepResults.map(({ step, result }) => ({
            step: step.step,
            success: result.success,
            summary: result.summary,
          })),
        },
        timestamp: Date.now(),
      })
    }

    if (anyFailed) {
      state.status = 'steering'
      const db2 = getDb()
      db2.run('UPDATE goals SET status = ? WHERE id = ?', ['steering', state.id])
      saveDb()

      this.saveMessage(state.id, 'system', `Step ${firstFailed!.step} failed. What would you like to do?`, {
        step: firstFailed!.step,
        description: firstFailed!.description,
        steerOptions: [
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
          prompt: `Step ${firstFailed!.step} failed. What would you like to do?`,
          options: [
            { label: 'Retry', action: 'redo' },
            { label: 'Skip step', action: 'skip' },
            { label: 'Stop', action: 'stop' },
          ],
        },
        timestamp: Date.now(),
      })
    } else {
      await this.executeNextStep(state)
    }
  }

  private async executeNextStep(state: GoalState): Promise<void> {
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

      await openCodeManager.release(state.projectId)
      return
    }

    await this.executeStepBatch(state)
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
