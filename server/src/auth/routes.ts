import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuid } from 'uuid'
import { getDb, saveDb } from '../db/index.js'
import { getJwtSecret } from './middleware.js'

const { hash, compare } = bcrypt
const { sign } = jwt

const auth = new Hono()

auth.post('/register', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch (e) {
    c.status(400)
    return c.json({ error: 'Invalid JSON payload', code: 'BAD_REQUEST' })
  }
  const { email, password } = body

  if (!email || !password) {
    c.status(400)
    return c.json({ error: 'Email and password are required', code: 'VALIDATION_ERROR' })
  }

  if (password.length < 6) {
    c.status(400)
    return c.json({ error: 'Password must be at least 6 characters', code: 'VALIDATION_ERROR' })
  }

  const db = getDb()

  const existing = db.exec('SELECT id FROM users WHERE email = ?', [email.toLowerCase()])
  if (existing[0]?.values.length > 0) {
    c.status(409)
    return c.json({ error: 'Email already registered', code: 'CONFLICT' })
  }

  const id = uuid()
  const passwordHash = await hash(password, 10)

  db.run(
    'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
    [id, email.toLowerCase(), passwordHash]
  )
  saveDb()

  const token = sign({ userId: id, email: email.toLowerCase() }, getJwtSecret(), { expiresIn: '7d' })

  c.status(201)
  return c.json({ token, user: { id, email: email.toLowerCase() } })
})

auth.post('/login', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch (e) {
    c.status(400)
    return c.json({ error: 'Invalid JSON payload', code: 'BAD_REQUEST' })
  }
  const { email, password } = body

  if (!email || !password) {
    c.status(400)
    return c.json({ error: 'Email and password are required', code: 'VALIDATION_ERROR' })
  }

  const db = getDb()

  const result = db.exec(
    'SELECT id, email, password_hash FROM users WHERE email = ?',
    [email.toLowerCase()]
  )

  const rows = result[0]?.values
  if (!rows?.length) {
    c.status(401)
    return c.json({ error: 'Invalid email or password', code: 'UNAUTHORIZED' })
  }

  const [userId, userEmail, passwordHash] = rows[0] as [string, string, string]
  const valid = await compare(password, passwordHash)

  if (!valid) {
    c.status(401)
    return c.json({ error: 'Invalid email or password', code: 'UNAUTHORIZED' })
  }

  const token = sign({ userId, email: userEmail }, getJwtSecret(), { expiresIn: '7d' })

  return c.json({ token, user: { id: userId, email: userEmail } })
})

export default auth
