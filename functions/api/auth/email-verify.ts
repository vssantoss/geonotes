import { json, HttpError, route } from '../../_lib/http'
import { sha256Hex, timingSafeEqual } from '../../_lib/crypto'
import { claimEmailCodeAttempt, consumeEmailCode } from '../../_lib/email-code'
import { signEnrollToken } from '../../_lib/enroll'
import { enforceAuthAbuseLimit } from '../../_lib/rate-limit'
import { normalizeEmail } from './email-request'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/email-verify {email, code}: checks the sign-in code and, on
 * success, returns a short-lived enroll token proving the address was verified.
 * The token authorizes enrolling a passkey (account creation or recovery); it
 * is NOT a session, so an e-mail code alone never signs anyone in.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  await enforceAuthAbuseLimit(env, request)
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; code?: unknown }
    | null
  const email = normalizeEmail(body?.email)
  const code = typeof body?.code === 'string' ? body.code : ''
  if (!/^\d{6}$/.test(code)) throw new HttpError(401, 'bad code')

  const claimed = await claimEmailCodeAttempt(env, email, Date.now())
  if (!claimed) throw new HttpError(401, 'bad code')

  if (!timingSafeEqual(claimed.codeHash, await sha256Hex(`${code}:${email}`))) {
    throw new HttpError(401, 'bad code')
  }

  if (!(await consumeEmailCode(env, email, claimed.codeHash))) throw new HttpError(401, 'bad code')

  return json({ enrollToken: await signEnrollToken(env, email) })
})
