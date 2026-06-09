import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA, MIGRATIONS } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', '..', 'data')
const DB_PATH = join(DATA_DIR, 'storm.db')

let db: SqlJsDatabase

/**
 * Initialize the SQLite database, creating tables if needed.
 */
export async function initDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs()

  if (!existsSync(DATA_DIR)) {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(DATA_DIR, { recursive: true })
  }

  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(SCHEMA)

  // Apply incremental migrations (swallow errors for existing columns)
  for (const migration of MIGRATIONS) {
    try {
      db.run(migration)
    } catch {
      // column already exists, ignore
    }
  }

  saveDb()

  return db
}

/**
 * Persist the in-memory database to disk.
 */
export function saveDb(): void {
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(DB_PATH, buffer)
}

/**
 * Get the database instance. Must call initDb() first.
 */
export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

export function closeDb(): void {
  if (db) {
    saveDb()
    db.close()
  }
}
