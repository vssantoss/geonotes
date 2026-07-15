import { HttpError } from './http'
import { randomHex, sha256Hex } from './crypto'
import type { Env } from './env'

/** Sessions live seven days; the app re-authenticates lazily on 401. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Cookie name scoped to this host and all application paths. */
const SESSION_COOKIE = '__Host-geonotes_session'
/** How stale last_seen may get before requireUser refreshes it. Throttled so
    an authenticated request adds a session write at most once per window. */
const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000

/**
 * Issues a new browser session for a user. Only the token's hash is stored.
 *
 * @param env - function environment.
 * @param userId - the authenticated user.
 * @param request - request carrying any session that should be rotated away.
 * @returns a Set-Cookie value containing the new opaque token.
 */
export async function createSession(env: Env, userId: string, request: Request): Promise<string> {
  const token = randomHex(32)
  const now = Date.now()
  // A public per-session id (used to revoke a specific session), plus creation
  // time, last-seen time and the user agent for the settings sessions list.
  const insert = env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, id, created_at, last_seen, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    await sha256Hex(token),
    userId,
    now + SESSION_TTL_MS,
    randomHex(16),
    now,
    now,
    request.headers.get('User-Agent') ?? null,
  )
  const previous = readSessionCookie(request)
  if (previous) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(previous)),
      insert,
    ])
  } else {
    await insert.run()
  }
  return buildSessionCookie(token, SESSION_TTL_MS / 1000)
}

/**
 * Authenticates a request via its host-only HttpOnly session cookie.
 *
 * @param env - function environment.
 * @param request - incoming request.
 * @returns the user id.
 * @throws HttpError(401) when the token is missing, unknown or expired.
 */
export async function requireUser(env: Env, request: Request): Promise<string> {
  const token = readSessionCookie(request)
  if (!token) throw new HttpError(401, 'missing token')
  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    'SELECT user_id, expires_at, last_seen FROM sessions WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: number; last_seen: number | null }>()
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, 'invalid session')
  // Refresh last_seen for the sessions list, throttled so most requests skip the
  // write (a stale-by-15-min bound keeps the "last active" time useful cheaply).
  const now = Date.now()
  if (row.last_seen === null || row.last_seen < now - LAST_SEEN_THROTTLE_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?')
      .bind(now, tokenHash)
      .run()
  }
  return row.user_id
}

/**
 * Revokes the session carried by the request and returns a cookie deletion.
 *
 * @param env - function environment.
 * @param request - incoming request.
 * @returns a Set-Cookie value that expires the browser cookie.
 */
export async function destroySession(env: Env, request: Request): Promise<string> {
  const token = readSessionCookie(request)
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .run()
  }
  return buildSessionCookie('', 0)
}

/**
 * Builds the host-only browser session cookie.
 *
 * @param token - opaque session token, or an empty value when deleting it.
 * @param maxAge - cookie lifetime in seconds.
 * @returns a Set-Cookie header value.
 */
export function buildSessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
}

/**
 * Hashes the request's session token the same way it is stored, so an endpoint
 * can recognise which listed session row belongs to the caller's own device.
 *
 * @param request - incoming request.
 * @returns the stored token hash, or null when no session cookie is present.
 */
export async function currentSessionHash(request: Request): Promise<string | null> {
  const token = readSessionCookie(request)
  return token ? sha256Hex(token) : null
}

/**
 * Reads the session cookie without decoding unrelated cookie data.
 *
 * @param request - incoming request.
 * @returns the session token, or null when absent.
 */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === SESSION_COOKIE) return value.join('=')
  }
  return null
}
