import { readdir, readFile } from 'node:fs/promises'
import { Miniflare } from 'miniflare'
import type { Env } from '../../worker/_lib/env'

/**
 * A throwaway D1 database with the real migrations applied, for tests that need
 * SQLite to actually run the SQL.
 *
 * Most of the interesting behaviour in worker/_lib and worker/api/sync.ts lives
 * in single statements that are deliberately atomic: conditional upserts,
 * DELETE..RETURNING, fixed-window counters. A hand-rolled fake `DB.prepare` can
 * only assert which strings were passed to it, which tests nothing about whether
 * the SQL is correct. Running it against real SQLite does.
 */
export interface TestDb {
  /** A complete Env backed by the real database. Optional bindings are left
      unset so the rate-limit and Turnstile checks take their skip paths. */
  env: Env
  /** The database itself, for arranging fixtures and asserting final state. */
  db: D1Database
  /** Tears down the underlying miniflare instance. */
  dispose: () => Promise<void>
}

/** Directory holding the numbered migration files, relative to the repo root. */
const MIGRATIONS_DIR = 'migrations'

/** The production origin, which the CSRF check and WebAuthn are both bound to. */
export const TEST_ORIGIN = 'https://gnotes.vshub.app'

/**
 * Splits a migration file into executable statements.
 *
 * D1's `exec` splits on newlines, which breaks on the multi-line CREATE TABLEs
 * in these migrations, so statements are extracted here instead. Line comments
 * are stripped first, otherwise a `--` would swallow everything after it once
 * the statement is rejoined.
 * @param sql Raw contents of a migration file.
 * @returns Non-empty SQL statements in file order.
 */
function splitStatements(sql: string): string[] {
  return sql
    .replaceAll(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

/**
 * Creates an isolated in-memory D1 database with every migration applied.
 *
 * Migrations are read from disk rather than restated in the test, so a schema
 * change that breaks a query is caught here rather than in production.
 * @returns The database, an Env wrapping it, and a dispose function. Always call
 *   dispose in afterEach, or the miniflare workerd process outlives the test run.
 */
export async function createTestDb(): Promise<TestDb> {
  const mf = new Miniflare({
    modules: true,
    // A do-nothing Worker: only the D1 binding is used, never the fetch handler.
    script: 'export default { fetch: () => new Response(null, { status: 404 }) }',
    d1Databases: { DB: 'test-db' },
  })
  const db = (await mf.getD1Database('DB')) as unknown as D1Database

  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8')
    await db.batch(splitStatements(sql).map((statement) => db.prepare(statement)))
  }

  return {
    db,
    env: {
      DB: db,
      ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
      ENVIRONMENT: 'dev',
      RP_ID: 'gnotes.vshub.app',
      ORIGIN: TEST_ORIGIN,
      AUTH_SECRET: 'test-secret',
    },
    dispose: () => mf.dispose(),
  }
}

/**
 * Inserts a user row, since almost every table references one.
 *
 * @param db Database to insert into.
 * @param id User id.
 * @param email Address for the user; must be unique within the database.
 * @returns Nothing.
 */
export async function insertUser(db: D1Database, id: string, email: string): Promise<void> {
  await db
    .prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
    .bind(id, email, Date.now())
    .run()
}
