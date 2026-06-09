# Storm

A hosted web service wrapping opencode with a Claude-like UI. Users submit coding goals, a free DeepSeek agent works on them autonomously in sandboxed environments, and users watch/steer in real-time.

## Tech Stack

- **Frontend**: React 19 + Vite + Tailwind CSS
- **Backend**: Hono + TypeScript (Node.js)
- **Database**: sql.js (pure JS SQLite, no native deps)
- **Auth**: JWT (email + password, bcrypt)
- **AI Engine**: @opencode-ai/sdk → opencode/deepseek-v4-flash-free
- **Real-time**: SSE (Server-Sent Events)
- **Sandbox**: Local directories (dev) or Daytona cloud VMs (DAYTONA_API_KEY)
- **Preview**: Server-proxied (CSP/X-Frame-Options stripped, asset paths rewritten)
- **Deployment**: Docker + Caddy on DigitalOcean (4GB/2vCPU)
- **Docs**: Raw HTML + Tailwind CSS + Mermaid.js

## Project Structure

```
storm/
├── server/           # Hono backend
│   └── src/
│       ├── index.ts
│       ├── db/       # Schema, migrations, connection
│       ├── auth/     # JWT middleware, routes
│       ├── routes/   # Projects, goals, steering, files
│       ├── agent/    # Planner, executor, orchestrator
│       ├── daytona.ts
│       └── sandbox.ts
├── web/              # React frontend
│   └── src/
│       ├── pages/    # Login, Dashboard, ProjectView
│       ├── components/ # ChatStream, Steering, FileTree, RightPanel, etc.
│       └── hooks/    # useAuth, useAgentStream
├── docs/             # HTML documentation
│   ├── pages/
│   └── assets/
├── docker-compose.yml
└── Caddyfile
```

## Architecture

```
Browser (React + Tailwind) ←→ Hono Backend ←→ opencode SDK ←→ Free DeepSeek
                              ↕                    ↕
                           SQLite DB    Sandbox dirs / Daytona VMs (1/project)
```

## Key Design Decisions

- **Hosted service**: Multi-user, accessible via browser from anywhere
- **Sandboxed execution**: Local dirs (dev) or Daytona cloud VMs (production) — true isolation
- **Agent loop**: Goal → Plan (PLAN.md) → User approves → Execute steps → User steers → Complete
- **Free model**: opencode/deepseek-v4-flash-free — no API key needed, built into opencode
- **Preview proxied through server**: Strips CSP/X-Frame-Options, rewrites HTML asset paths; adds X-Daytona-Skip-Preview-Warning header
- **sql.js over better-sqlite3**: Avoid native compilation issues on Windows
- **Hono over Express**: Lighter, TypeScript-native, built-in CORS
- **SSE over WebSocket**: Simpler, native EventSource in browsers, no library needed
- **Fresh session per execution step**: Avoid context pollution
- **Plan approval required**: Steps auto-continue autonomously after approval
- **Goal messages persisted**: Reconnecting users see full history
- **Plan as file (PLAN.md)**: Written to sandbox, updated live as steps complete
- **Lazy local sandbox**: Created on first file access when DAYTONA_API_KEY is unset

## Progress

### Done
- Full project scaffold: server (Hono, TypeScript ESM, sql.js), frontend (Vite + React 19 + TypeScript + Tailwind CSS 3 + React Router 7)
- SQLite schema + auto-migration with daytona_sandbox_id and daytona_opencode_url columns
- Auth module: register/login with bcrypt + JWT middleware (7-day expiry), ?token= query param support
- Project CRUD routes + sandbox auto-discovery
- Unified sandbox manager: dispatches to Daytona or local based on DAYTONA_API_KEY
- Daytona SDK integration: create/delete sandbox, dev server start, file operations — E2E tested
- Agent orchestrator: full lifecycle with EventEmitter, SSE streaming, message persistence
- Streaming executor with real-time step_progress, tool_call, file_edit events
- Goal routes: POST goals, GET /stream (SSE), POST steer, GET goal, GET goal list, GET messages
- Backend files route: recursive tree + file content — proxies through Daytona or lazy-creates local sandbox
- Dev server manager: delegates to Daytona or local Vite spawn; returns { url, error? }
- Preview route: proxies to Daytona preview URL, strips CSP/X-Frame-Options, rewrites asset paths, falls back to Daytona FS reads or local files
- Preview HEAD handler: fast static file check → DB project-existence fallback (200 if project exists, even without index.html)
- Lazy local sandbox creation: file routes create SANDBOX_ROOT/projectId when sandbox_path is null
- PLAN.md: written to sandbox after plan generation, updated live on each step complete/failure
- Parallel sub-agent execution: batch formation, Promise.all, parallel_start/parallel_complete events
- Frontend: API client, useAuth hook, useAgentStream with SSE + message buffering + past message loading
- Login page, Dashboard, ProjectView (50/50 split with react-resizable-panels)
- Tabbed RightPanel: Code (file tree + editor), Preview (iframe), Agent Logs
- PreviewTab probes /api/preview/{projectId}/ with HEAD; shows iframe on 200, else Start Dev Server button
- Step timeline replaces step cards; click-to-expand tool calls
- Real-time stepStates — tool calls appear immediately
- PlanNotice (compact) replaces PlanSection — view PLAN.md link + approve/regenerate
- AiResponseBubble with unified turn grouping
- File tree live refresh every 3s during execution with pulsing "live" indicator
- Fullscreen preview toggle
- Auth 401 handling: clears localStorage + redirects to /
- Markdown formatting via formatText() + FormattedText.tsx
- HTML docs: 5 pages with Mermaid.js diagrams
- E2E test script

### In Progress
- (none)

### Blocked
- (none)

## Relevant Files
- `server/src/index.ts`: Preview routes (GET + HEAD handlers), dev server routes, lookupSandbox(), serveStatic(), serveViaProxy()
- `server/src/daytona.ts`: Core Daytona integration
- `server/src/sandbox.ts`: writeSandboxFile(), readSandboxFile() — dispatches to local FS or Daytona
- `server/src/agent/orchestrator.ts`: buildPlanMd(), updatePlanMd(), failedSteps tracking
- `server/src/routes/files.ts`: File tree + content with lazy sandbox creation
- `server/src/routes/goals.ts`: SSE stream handler, steer, goal CRUD
- `server/src/agent/planner.ts`: SubTask with optional agent field, agent prompts
- `server/src/agent/executor.ts`: Accepts agentName + systemPrompt params
- `server/src/agent/manager.ts`: OpenCodeManager — caches clients by URL key
- `server/src/dev-server.ts`: ensureDevServer() returns { url, error? }
- `web/src/components/ChatStream.tsx`: PlanNotice, step timeline, AiResponseBubble
- `web/src/hooks/useAgentStream.ts`: SSE parsing, stepStates, message loading
- `web/src/components/RightPanel.tsx`: FilesTab, PreviewTab with HEAD probe
- `web/src/lib/api.ts`: connectGoalStream(), request() with 401 handling

## Coding Conventions

- TypeScript everywhere (server + web)
- No semicolons
- Single quotes for strings
- Async/await over promises
- Routes follow RESTful conventions
- Server errors return { error: string, code: string }
- Prefer small focused files over large monoliths
