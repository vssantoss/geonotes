import { json, HttpError, route } from '../../_lib/http'
import { sha256Hex, timingSafeEqual } from '../../_lib/crypto'
import { signEnrollToken } from '../../_lib/enroll'
import { normalizeEmail } from './email-request'
import type { Env } from '../../_lib/env'

/** A code is burned after this many wrong attempts. */
const MAX_ATTEMPTS = 5

/**
 * POST /api/auth/email-verify {email, code}: checks the sign-in code and, on
 * success, returns a short-lived enroll token proving the address was verified.
 * The token authorizes enrolling a passkey (account creation or recovery); it
 * is NOT a session, so an e-mail code alone never signs anyone in.
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

  return json({ enrollToken: await signEnrollToken(env, email) })
})
