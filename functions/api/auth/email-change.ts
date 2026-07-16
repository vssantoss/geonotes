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

  // Reject an address already owned by another account, and reject changing to
  // the account's own current address (a no-op the UI should not allow). E-mail
  // is unique per user, so a row owned by this user means the address is unchanged.
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(newEmail)
    .first<{ id: string }>()
  if (existing) {
    throw existing.id === userId
      ? new HttpError(409, 'email unchanged')
      : new HttpError(409, 'email already in use')
  }

  await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(newEmail, userId).run()

  return json({ ok: true, email: newEmail })
})
