import { json, HttpError, route } from '../../_lib/http'
import { claimEmailCodeRequest, issueEmailCode, pruneExpiredEmailCodes } from '../../_lib/email-code'
import { getEmailSender } from '../../_lib/email'
import { enforceAuthAbuseLimit } from '../../_lib/rate-limit'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/email-request {email, mode?}: generates a 6-digit confirmation
 * code, stores only its hash and hands it to the e-mail sender. In dev mode the
 * code is echoed back so the flow works without a provider.
 *
 * mode 'create' (the default) always sends, since creating an account
 * necessarily targets an address without one yet, and can return 429 when a
 * code was sent very recently.
 *
 * mode 'recover' only sends when a recoverable account (a user with at least one
 * credential) already exists, and NEVER surfaces the cooldown as a 429: it
 * always answers 200 {sent:true} whether or not an account exists and whether or
 * not a code was actually sent, so neither the status nor the body can be used
 * to tell whether an address has an account. Creating an account is the only
 * flow that reveals an address is free (by succeeding), which requires control
 * of the mailbox, so it cannot be used to enumerate other people's accounts.
 */
export const onRequestPost = route<Env>(async ({ env, request, waitUntil }) => {
  await enforceAuthAbuseLimit(env, request)
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; mode?: unknown }
    | null
  const email = normalizeEmail(body?.email)
  const mode = body?.mode === 'recover' ? 'recover' : 'create'
  const now = Date.now()
  // Opportunistic TTL eviction of expired codes and lapsed rate-limit windows,
  // amortized onto the same requests that grow those tables. Runs after the
  // response so it never adds latency, and never affects this request's result.
  waitUntil(pruneExpiredEmailCodes(env, now))
  const withinAccountLimit = await claimEmailCodeRequest(env, email, now)

  if (mode === 'recover') {
    const account = await env.DB.prepare(
      'SELECT 1 AS ok FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.email = ? LIMIT 1',
    )
      .bind(email)
      .first<{ ok: number }>()
    // Send only for a real account and only when not in cooldown, but always
    // answer identically so nothing distinguishes the cases in production.
    const code = account && withinAccountLimit ? await issueCode(env, email) : null
    return json({ sent: true, ...(env.ENVIRONMENT === 'dev' && code ? { devCode: code } : {}) })
  }

  if (!withinAccountLimit) throw new HttpError(429, 'too many code requests')
  const code = await issueCode(env, email)
  if (!code) throw new HttpError(429, 'code recently sent')
  return json({ sent: true, ...(env.ENVIRONMENT === 'dev' ? { devCode: code } : {}) })
})

/**
 * Generates and sends a fresh code when the address cooldown permits it.
 *
 * @param env - function environment.
 * @param email - canonicalized recipient address.
 * @returns the plaintext code for the dev echo, or null during cooldown.
 */
async function issueCode(env: Env, email: string): Promise<string | null> {
  const code = await issueEmailCode(env, email, Date.now())
  if (!code) return null
  await getEmailSender(env).sendCode(email, code)
  return code
}

/**
 * Validates and canonicalizes an e-mail address.
 *
 * @param value - candidate from the request body.
 * @returns the lowercased address.
 * @throws HttpError(400) when it does not look like an e-mail.
 */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'bad email')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'bad email')
  }
  return email
}
