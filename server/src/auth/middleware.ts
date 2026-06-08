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
 * Verify JWT from Authorization header or ?token= query param.
 * Sets c.set('user', { userId, email }) on success.
 */
export async function authMiddleware(c: Context<{ Variables: Variables }>, next: Next): Promise<Response | void> {
  let token: string | null = c.req.query('token') || null

  if (!token) {
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }
  }

  if (!token) {
    return c.json({ error: 'Missing or invalid authorization', code: 'UNAUTHORIZED' }, 401)
  }

  try {
    const payload = verify(token, JWT_SECRET) as AuthPayload
    c.set('user', payload)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' }, 401)
  }
}

export function getJwtSecret(): string {
  return JWT_SECRET
}
