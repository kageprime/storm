import { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
const { verify } = jwt

const JWT_SECRET = process.env.JWT_SECRET || 'storm-dev-secret-change-in-production'

export interface AuthPayload {
  userId: string
  email: string
}

export type Variables = {
  user: AuthPayload
}

/**
 * Verify JWT from Authorization header and attach user info to context.
 * Sets c.set('user', { userId, email }) on success.
 */
export async function authMiddleware(c: Context<{ Variables: Variables }>, next: Next): Promise<void> {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    c.status(401)
    c.json({ error: 'Missing or invalid authorization header', code: 'UNAUTHORIZED' })
    return
  }

  const token = authHeader.slice(7)

  try {
    const payload = verify(token, JWT_SECRET) as AuthPayload
    c.set('user', payload)
    await next()
  } catch {
    c.status(401)
    c.json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' })
  }
}

export function getJwtSecret(): string {
  return JWT_SECRET
}
