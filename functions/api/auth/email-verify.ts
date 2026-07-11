import { json, HttpError, route } from '../../_lib/http'
import { sha256Hex, timingSafeEqual } from '../../_lib/crypto'
import { createSession } from '../../_lib/session'
import { normalizeEmail } from './email-request'
import type { Env } from '../../_lib/env'

/** A code is burned after this many wrong attempts. */
const MAX_ATTEMPTS = 5

/**
 * POST /api/auth/email-verify {email, code}: checks the code and issues a
 * session, creating the user account on first sign-in.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; code?: unknown }
    | null
  const email = normalizeEmail(body?.email)
  const code = typeof body?.code === 'string' ? body.code : ''
  if (!/^\d{6}$/.test(code)) throw new HttpError(401, 'bad code')

  const row = await env.DB.prepare(
    'SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = ?',
  )
    .bind(email)
    .first<{ code_hash: string; expires_at: number; attempts: number }>()
  if (!row || row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    throw new HttpError(401, 'bad code')
  }

  if (!timingSafeEqual(row.code_hash, await sha256Hex(`${code}:${email}`))) {
    await env.DB.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?')
      .bind(email)
      .run()
    throw new HttpError(401, 'bad code')
  }

  await env.DB.prepare('DELETE FROM email_codes WHERE email = ?').bind(email).run()

  const userId = await findOrCreateUser(env, email)
  return json({ token: await createSession(env, userId) })
})

/**
 * Finds the user for an address or creates one (first sign-in is sign-up:
 * with passwordless auth, proving mailbox ownership is the registration).
 *
 * @param env - function environment.
 * @param email - canonicalized address.
 * @returns the user id.
 */
export async function findOrCreateUser(env: Env, email: string): Promise<string> {
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (existing) return existing.id
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
    .bind(id, email, Date.now())
    .run()
  return id
}
