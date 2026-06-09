/**
 * Planner — decomposes a high-level goal into structured sub-tasks
 * using opencode's structured output capabilities.
 */

export interface SubTask {
  step: number
  description: string
  files: string[]
  agent?: string
}

export const UI_PROMPT = `You are a UI designer specializing in HTML and CSS.
Create clean, responsive layouts with semantic HTML and well-organized CSS.
Use class-based styling in a separate style.css file.
Follow the project structure rules.`

export const VISUALIZER_PROMPT = `You are a 3D and data visualization expert.
Use Three.js, D3.js, or Canvas2D loaded from CDN via <script> tags.
Create smooth animations with proper requestAnimationFrame loops.
Organize visualization code into separate .js files under src/.
Export a setup function that the main entry point can call.`

export const REVIEWER_PROMPT = `You are a code reviewer. Check all project files for:
- Correctness — does the code work without errors?
- Completeness — are all required files created and linked?
- Consistency — do script src paths and file imports match actual files?
- Fix any issues you find by editing the affected files.
Only modify files that have problems.`

export const CODING_CONVENTIONS = `Project structure rules — FOLLOW STRICTLY:
- Use plain HTML + CSS + JavaScript. ONLY use npm/Vite/React when the goal explicitly requires a framework.
- Load JS libraries from CDN via <script src="..."> tags or importmaps.
- Organize code into multiple .js files under a src/ directory.
- Entry point is always index.html at the project root.
- All files must be static — no build step. The preview system serves files directly.
- Use .js (not .ts). Use plain .css (no Tailwind).`

const PLAN_PROMPT = `${CODING_CONVENTIONS}

You are a senior software architect. Given a high-level coding goal, break it down into 3-8 concrete, sequential sub-tasks that can be executed independently.

For each sub-task, specify:
- step: sequential number
- description: clear, actionable description of what to do
- files: array of file paths that will likely be created or modified
- agent: (optional) which specialist should handle this step — "ui" for HTML/CSS, "visualizer" for JS animation/visualization, "reviewer" for final review, or omit for general tasks

Steps that don't share file dependencies can run in parallel. Assign different agents to independent steps.

Output ONLY a valid JSON array. No markdown, no code fences, no explanation.

Example:
[
  {"step": 1, "description": "Create the HTML structure and CSS styles", "files": ["index.html", "style.css"], "agent": "ui"},
  {"step": 2, "description": "Create the Three.js animation", "files": ["src/main.js"], "agent": "visualizer"},
  {"step": 3, "description": "Review and fix any issues", "files": [], "agent": "reviewer"}
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
        agent: typeof item.agent === 'string' ? item.agent : undefined,
      }))
    }
    throw new Error('Response is not an array')
  } catch (err) {
    throw new Error(`Failed to parse plan: ${err instanceof Error ? err.message : 'unknown error'}`)
  }
}

export function promptForAgent(agent?: string): string | undefined {
  if (agent === 'ui') return UI_PROMPT
  if (agent === 'visualizer') return VISUALIZER_PROMPT
  if (agent === 'reviewer') return REVIEWER_PROMPT
  return undefined
}

export { PLAN_PROMPT }
