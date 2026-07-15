import { json, HttpError, route } from '../../_lib/http'
import { requireUser } from '../../_lib/session'
import { verifyEnrollToken } from '../../_lib/enroll'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/email-change {enrollToken}: changes the signed-in account's
 * e-mail to a new address whose ownership was just proven. The client runs the
 * normal e-mail-code flow against the NEW address (email-request +
 * email-verify) to obtain the enroll token; this endpoint verifies that token,
 * ensures the address is not already taken by another account, and updates the
 * user row. The account id, notes and sessions are unaffected.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)
  const body = (await request.json().catch(() => null)) as { enrollToken?: unknown } | null
  if (typeof body?.enrollToken !== 'string') throw new HttpError(400, 'bad body')

  const newEmail = await verifyEnrollToken(env, body.enrollToken)

  // Reject an address already owned by a different account. Changing to the
  // account's own current address is a no-op that still succeeds.
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(newEmail)
    .first<{ id: string }>()
  if (existing && existing.id !== userId) throw new HttpError(409, 'email already in use')

  await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(newEmail, userId).run()

  return json({ ok: true, email: newEmail })
})
