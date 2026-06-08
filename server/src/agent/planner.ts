/**
 * Planner — decomposes a high-level goal into structured sub-tasks
 * using opencode's structured output capabilities.
 */

export interface SubTask {
  step: number
  description: string
  files: string[]
}

const PLAN_PROMPT = `You are a senior software architect. Given a high-level coding goal, break it down into 3-8 concrete, sequential sub-tasks that can be executed independently.

For each sub-task, specify:
- step: sequential number
- description: clear, actionable description of what to do
- files: array of file paths that will likely be created or modified

Output ONLY a valid JSON array. No markdown, no code fences, no explanation.

Example:
[
  {"step": 1, "description": "Initialize the project with package.json and install dependencies", "files": ["package.json"]},
  {"step": 2, "description": "Create the database schema and models", "files": ["src/models.js", "src/db.js"]}
]

Goal:`

export async function parsePlanResponse(text: string): Promise<SubTask[]> {
  const cleaned = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*$/gm, '')
    .trim()

  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) {
      return parsed.map((item, i) => ({
        step: item.step ?? i + 1,
        description: item.description || '',
        files: Array.isArray(item.files) ? item.files : [],
      }))
    }
    throw new Error('Response is not an array')
  } catch (err) {
    throw new Error(`Failed to parse plan: ${err instanceof Error ? err.message : 'unknown error'}`)
  }
}

export { PLAN_PROMPT }
