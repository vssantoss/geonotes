import { HttpError } from './http'
import { randomHex, sha256Hex } from './crypto'
import type { Env } from './env'

/** Sessions live 90 days; the app re-authenticates lazily on 401. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Issues a new bearer session for a user. Only the token's hash is stored.
 *
 * @param env - function environment.
 * @param userId - the authenticated user.
 * @returns the raw token to hand to the client (never stored server-side).
 */
export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomHex(32)
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  )
    .bind(await sha256Hex(token), userId, Date.now() + SESSION_TTL_MS)
    .run()
  return token
}

/**
 * Authenticates a request via its Authorization bearer token.
 *
 * @param env - function environment.
 * @param request - incoming request.
 * @returns the user id.
 * @throws HttpError(401) when the token is missing, unknown or expired.
 */
export async function requireUser(env: Env, request: Request): Promise<string> {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw new HttpError(401, 'missing token')
  const row = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
  )
    .bind(await sha256Hex(token))
    .first<{ user_id: string; expires_at: number }>()
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, 'invalid session')
  return row.user_id
}

/**
 * Revokes the session carried by the request, if any.
 *
 * @param env - function environment.
 * @param request - incoming request.
 */
export async function destroySession(env: Env, request: Request): Promise<void> {
  const header = request.headers.get('Authorization') ?? ''
  if (!header.startsWith('Bearer ')) return
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(header.slice(7)))
    .run()
}
