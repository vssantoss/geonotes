import { describe, expect, it } from 'vitest'
import { app } from './router'
import type { Env } from './_lib/env'

const ORIGIN = 'https://gnotes.vshub.app'

/** A prepared statement's recorded call, for asserting what a route bound. */
interface RecordedStatement {
  sql: string
  args: unknown[]
}

/**
 * Builds a stand-in D1 database that records every statement and answers with
 * canned rows, so a route can be driven far enough to prove the router wired it
 * up without a real database behind it.
 *
 * @param rows - first() results, matched by a substring of the statement's SQL.
 *   The first matching entry wins; unmatched statements return null.
 * @returns the fake binding plus the list of statements it saw, in order.
 */
function fakeDb(rows: [match: string, row: unknown][] = []): {
  db: D1Database
  seen: RecordedStatement[]
} {
  const seen: RecordedStatement[] = []
  const db = {
    prepare(sql: string) {
      const statement = {
        bind(...args: unknown[]) {
          seen.push({ sql, args })
          return statement
        },
        first: async () => rows.find(([match]) => sql.includes(match))?.[1] ?? null,
        run: async () => ({ meta: { changes: 1 } }),
        all: async () => ({ results: [] }),
      }
      return statement
    },
    batch: async () => [],
  }
  return { db: db as unknown as D1Database, seen }
}

/**
 * Builds a minimal Worker environment. Optional bindings are left unset so the
 * rate-limit and Turnstile checks take their skip paths.
 *
 * @param db - the database binding to expose.
 * @returns an Env usable as Hono bindings.
 */
function fakeEnv(db: D1Database): Env {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    ENVIRONMENT: 'dev',
    RP_ID: 'gnotes.vshub.app',
    ORIGIN,
    AUTH_SECRET: 'test-secret',
  }
}

describe('router', () => {
  it('rejects an unsafe request with no Origin header', async () => {
    const res = await app.request('/api/sync', { method: 'POST' }, fakeEnv(fakeDb().db))
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('bad origin')
  })

  it('rejects an unsafe request from a foreign Origin', async () => {
    const res = await app.request(
      '/api/sync',
      { method: 'POST', headers: { Origin: 'https://evil.example' } },
      fakeEnv(fakeDb().db),
    )
    expect(res.status).toBe(403)
  })

  it('passes the request through to the handler', async () => {
    // Out-of-range coordinates are rejected before any network or D1 access, so
    // this reaches real route logic and proves the shim forwards the request.
    const res = await app.request('/api/geocode?lat=999&lng=0', {}, fakeEnv(fakeDb().db))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('bad coordinates')
  })

  it('answers an unknown API path as an API error, not the SPA shell', async () => {
    // Without the /api/* guard this would fall through to the assets catch-all
    // and return index.html with a 200, which the client would fail to parse.
    const res = await app.request('/api/nope', {}, fakeEnv(fakeDb().db))
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  it('sets the API security headers the assets _headers file no longer covers', async () => {
    const res = await app.request('/api/nope', {}, fakeEnv(fakeDb().db))
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('serves a non-API path from the assets binding', async () => {
    const res = await app.request('/some/deep/link', {}, fakeEnv(fakeDb().db))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('asset')
  })

  it('passes the path parameter to a dynamic route', async () => {
    // The one thing the Hono shim genuinely re-implements: under Pages this id
    // came from the [id].ts filename, here from the ':id' pattern.
    const { db, seen } = fakeDb([
      ['FROM sessions WHERE token_hash', { user_id: 'u1', expires_at: Date.now() + 60_000, last_seen: Date.now(), revoked_at: null }],
      ['COUNT(*) AS n FROM credentials', { n: 2 }],
    ])
    const res = await app.request(
      '/api/auth/credentials/abc123',
      {
        method: 'DELETE',
        headers: { Origin: ORIGIN, Cookie: '__Host-geonotes_session=tok' },
      },
      fakeEnv(db),
    )
    expect(res.status).toBe(200)
    const deletion = seen.find((s) => s.sql.startsWith('DELETE FROM credentials'))
    expect(deletion?.args).toEqual(['abc123', 'u1'])
  })

  it('does not fail a request that schedules background work without an ExecutionContext', async () => {
    // app.request() supplies no ExecutionContext, so the shim's waitUntil has to
    // fall back rather than throw. email-request schedules the code prune.
    const res = await app.request(
      '/api/auth/email-request',
      {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'someone@example.com', mode: 'recover' }),
      },
      fakeEnv(fakeDb().db),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: true })
  })
})
