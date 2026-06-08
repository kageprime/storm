import { ReactNode } from 'react'

type Props = {
  user: { email: string }
  onLogout: () => void
  children: ReactNode
}

export function Layout({ user, onLogout, children }: Props) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-storm-border bg-storm-surface px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-storm-accent tracking-tight">
            Storm
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-storm-muted">{user.email}</span>
          <button
            onClick={onLogout}
            className="text-sm text-storm-muted hover:text-storm-text transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
