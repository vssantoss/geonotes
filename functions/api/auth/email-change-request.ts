import { json, HttpError, route } from '../../_lib/http'
import { requireUser } from '../../_lib/session'
import { claimEmailCodeRequest, issueEmailCode, pruneExpiredEmailCodes } from '../../_lib/email-code'
import { getEmailSender } from '../../_lib/email'
import { enforceAuthAbuseLimit } from '../../_lib/rate-limit'
import { normalizeEmail } from './email-request'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/email-change-request {email}: for the signed-in account, sends
 * a confirmation code to a prospective new address, but only once the address
 * is known to be available. Unlike account creation (which must not reveal
 * whether an address is taken), the caller here is already authenticated and the
 * final email-change step returns the same information, so checking up front
 * leaks nothing new while avoiding a code that could never be applied.
 *
 * Rejects the account's own current address (409 "email unchanged") and any
 * address owned by another account (409 "email already in use") WITHOUT sending.
 */
export const onRequestPost = route<Env>(async ({ env, request, waitUntil }) => {
  await enforceAuthAbuseLimit(env, request)
  const userId = await requireUser(env, request)
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = normalizeEmail(body?.email)
  const now = Date.now()
  // Same opportunistic TTL eviction as the account-creation code request.
  waitUntil(pruneExpiredEmailCodes(env, now))

  // Reject unavailable targets before issuing a code. E-mail is unique per user,
  // so a row owned by this user means the address is unchanged.
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (existing) {
    throw existing.id === userId
      ? new HttpError(409, 'email unchanged')
      : new HttpError(409, 'email already in use')
  }

  if (!(await claimEmailCodeRequest(env, email, now))) throw new HttpError(429, 'too many code requests')
  const code = await issueEmailCode(env, email, now)
  if (!code) throw new HttpError(429, 'code recently sent')
  await getEmailSender(env).sendCode(email, code)
  return json({ sent: true, ...(env.ENVIRONMENT === 'dev' ? { devCode: code } : {}) })
})
