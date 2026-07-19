import { json, HttpError, route } from '../../_lib/http'
import { requireUser } from '../../_lib/session'
import { getEmailSender } from '../../_lib/email'
import { enforceAuthAbuseLimit } from '../../_lib/rate-limit'
import { CONTACT_MESSAGE_MAX_LENGTH } from '../../../shared/types'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/contact {message}: delivers a short contact-form message from
 * the signed-in user to the app owner's inbox, with the user's own address set
 * as the Reply-To so a reply reaches them directly.
 *
 * Gated behind requireUser so it can never be used as an open relay: only an
 * authenticated account can send, and the message always goes to the fixed
 * owner address (never an attacker-chosen recipient). The message is plain
 * text, size-bounded, and rate-limited like the other auth endpoints.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  await enforceAuthAbuseLimit(env, request)
  const userId = await requireUser(env, request)
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null
  const message = normalizeMessage(body?.message)
  // The account's address becomes the e-mail's Reply-To. A users row always has
  // an e-mail (NOT NULL UNIQUE), so this lookup returns exactly one row.
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ email: string }>()
  if (!user) throw new HttpError(401, 'invalid session')
  // Sent inline (not on the background lane) so the UI can report a real
  // success or failure to the user, unlike the best-effort account notices.
  await getEmailSender(env).sendContactMessage(user.email, message)
  return json({ ok: true })
})

/**
 * Validates and trims a contact-form message.
 *
 * @param value - candidate from the request body.
 * @returns the trimmed message.
 * @throws HttpError(400) when it is missing, empty, or over the length bound.
 */
function normalizeMessage(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'bad message')
  const message = value.trim()
  if (message.length === 0 || message.length > CONTACT_MESSAGE_MAX_LENGTH) {
    throw new HttpError(400, 'bad message')
  }
  return message
}
