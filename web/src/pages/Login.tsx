import { useState, FormEvent } from 'react'

type Props = {
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (email: string, password: string) => Promise<void>
}

export function Login({ onLogin, onRegister }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isRegister) {
        await onRegister(email, password)
      } else {
        await onLogin(email, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-storm-bg px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-storm-accent tracking-tight mb-2">
            Storm
          </h1>
          <p className="text-storm-muted text-sm">
            {isRegister ? 'Create an account to get started' : 'Sign in to your account'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-storm-surface border border-storm-border rounded-xl p-6 space-y-4"
        >
          <div>
            <label className="block text-sm text-storm-muted mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-storm-bg border border-storm-border rounded-lg px-3 py-2 text-storm-text text-sm focus:outline-none focus:border-storm-accent transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-storm-muted mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-storm-bg border border-storm-border rounded-lg px-3 py-2 text-storm-text text-sm focus:outline-none focus:border-storm-accent transition-colors"
              placeholder="At least 6 characters"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-storm-accent hover:bg-storm-accent-hover text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Please wait...' : isRegister ? 'Create account' : 'Sign in'}
          </button>

          <p className="text-center text-sm text-storm-muted">
            {isRegister ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setIsRegister(false)}
                  className="text-storm-accent hover:underline"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                No account?{' '}
                <button
                  type="button"
                  onClick={() => setIsRegister(true)}
                  className="text-storm-accent hover:underline"
                >
                  Create one
                </button>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  )
}
