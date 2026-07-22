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

// The native (Capacitor) webview loads from https://localhost (Android) or
// capacitor://localhost (iOS), so its calls to the API are cross-origin and the
// browser needs CORS headers to let it read the response. The web app is
// same-origin and must stay unaffected.
const ANDROID_ORIGIN = 'https://localhost'
const IOS_ORIGIN = 'capacitor://localhost'

describe('CORS for native origins', () => {
  it('answers a preflight from the Android origin with the allowed origin and methods', async () => {
    const res = await app.request(
      '/api/sync',
      { method: 'OPTIONS', headers: { Origin: ANDROID_ORIGIN } },
      fakeEnv(fakeDb().db),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ANDROID_ORIGIN)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization')
    expect(res.headers.get('access-control-max-age')).toBe('86400')
  })

  it('answers a preflight from the iOS origin by reflecting that exact origin', async () => {
    const res = await app.request(
      '/api/sync',
      { method: 'OPTIONS', headers: { Origin: IOS_ORIGIN } },
      fakeEnv(fakeDb().db),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(IOS_ORIGIN)
  })

  it('does not grant CORS to a preflight from an untrusted origin', async () => {
    const res = await app.request(
      '/api/sync',
      { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } },
      fakeEnv(fakeDb().db),
    )
    // Still a 204, but with no allow-origin header the browser blocks the request.
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('reflects the origin onto a normal response so the WebView can read it', async () => {
    const res = await app.request(
      '/api/geocode?lat=999&lng=0',
      { headers: { Origin: ANDROID_ORIGIN } },
      fakeEnv(fakeDb().db),
    )
    // The route still runs and rejects the coordinates; CORS only adds headers.
    expect(res.status).toBe(400)
    expect(res.headers.get('access-control-allow-origin')).toBe(ANDROID_ORIGIN)
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('keeps the origin/CSRF rejection readable to the native client', async () => {
    // A native POST with no bearer token is still an ambient-credential request,
    // so requireTrustedOrigin rejects it; the 403 must carry CORS headers or it
    // surfaces as an opaque fetch failure rather than a readable body.
    const res = await app.request(
      '/api/sync',
      { method: 'POST', headers: { Origin: ANDROID_ORIGIN } },
      fakeEnv(fakeDb().db),
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe(ANDROID_ORIGIN)
  })

  it('lets a bearer-token POST clear the origin gate the cookie flow cannot skip', async () => {
    // Fix C: a request that authenticates by bearer token cannot be forged
    // cross-site (a page cannot read the token), so it is exempt from the Origin
    // check. With no session row behind the token it then fails auth with 401 --
    // that it is 401 and not 403 'bad origin' is the proof it passed the gate.
    const res = await app.request(
      '/api/sync',
      {
        method: 'POST',
        headers: {
          Origin: ANDROID_ORIGIN,
          Authorization: 'Bearer some-native-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ops: [], since: null }),
      },
      fakeEnv(fakeDb().db),
    )
    expect(res.status).toBe(401)
  })

  it('never allows credentialed (cookie) cross-origin sharing', async () => {
    // No Allow-Credentials header: native auth is a bearer token, not the cookie,
    // so the web cookie's SameSite/__Host- protections are never relaxed.
    const res = await app.request(
      '/api/geocode?lat=999&lng=0',
      { headers: { Origin: ANDROID_ORIGIN } },
      fakeEnv(fakeDb().db),
    )
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('leaves same-origin web responses untouched', async () => {
    const res = await app.request(
      '/api/geocode?lat=999&lng=0',
      { headers: { Origin: ORIGIN } },
      fakeEnv(fakeDb().db),
    )
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBeNull()
  })
})
