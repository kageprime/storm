# Storm

A hosted web service wrapping opencode with a Claude-like UI. Users submit coding goals, a free DeepSeek agent works on them autonomously in sandboxed environments, and users watch/steer in real-time.

## Tech Stack

- **Frontend**: React 19 + Vite + Tailwind CSS
- **Backend**: Hono + TypeScript (Node.js)
- **Database**: better-sqlite3
- **Auth**: JWT (email + password, bcrypt)
- **AI Engine**: @opencode-ai/sdk → opencode/deepseek-v4-flash-free
- **Real-time**: SSE (Server-Sent Events)
- **Sandbox**: Isolated directories per project (Docker planned)
- **Deployment**: Docker + Caddy on DigitalOcean (4GB/2vCPU)
- **Docs**: Raw HTML + Tailwind CSS

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
│       └── sandbox.ts
├── web/              # React frontend
│   └── src/
│       ├── pages/    # Login, Dashboard, ProjectView
│       ├── components/ # ChatStream, Steering, FileTree, etc.
│       └── hooks/    # useAuth, useAgentStream
├── docs/             # HTML documentation
│   ├── pages/
│   └── assets/
├── docker-compose.yml
└── Caddyfile
```

## Architecture

Browser (React + Tailwind) ←→ Hono Backend ←→ opencode SDK ←→ Free DeepSeek
                              ↕                    ↕
                           SQLite DB         Sandbox dirs (1/project)

## Key Design Decisions

- **Hosted service**: Multi-user, accessible via browser from anywhere
- **Sandboxed execution**: Each project gets an isolated directory; opencode operates only within it
- **Agent loop**: Goal → Plan (structured output) → User approves → Execute steps → User steers → Complete
- **Free model**: opencode/deepseek-v4-flash-free — no API key needed, built into opencode
- **Local-first, deploy-later**: Develop locally, deploy to DO at Sprint 6

## Coding Conventions

- TypeScript everywhere (server + web)
- No semicolons
- Single quotes for strings
- Async/await over promises
- JSDoc comments on exported functions
- Routes follow RESTful conventions
- Server errors return { error: string, code: string }
- Prefer small focused files over large monoliths
