import { json, HttpError, route } from '../../_lib/http'
import { claimEmailCodeRequest, issueEmailCode, pruneExpiredEmailCodes } from '../../_lib/email-code'
import { purgeExpiredDeletedAccounts } from '../../_lib/account-deletion'
import { getEmailSender } from '../../_lib/email'
import { enforceAuthAbuseLimit } from '../../_lib/rate-limit'
import { verifyTurnstile } from '../../_lib/turnstile'
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
 * mode 'recover' only sends when an account already exists for the address, and
 * NEVER surfaces the cooldown as a 429: it
 * always answers 200 {sent:true} whether or not an account exists and whether or
 * not a code was actually sent, so neither the status nor the body can be used
 * to tell whether an address has an account. Creating an account is the only
 * flow that reveals an address is free (by succeeding), which requires control
 * of the mailbox, so it cannot be used to enumerate other people's accounts.
 */
export const onRequestPost = route<Env>(async ({ env, request, waitUntil }) => {
  await enforceAuthAbuseLimit(env, request)
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; mode?: unknown; turnstileToken?: unknown }
    | null
  const email = normalizeEmail(body?.email)
  const mode = body?.mode === 'recover' ? 'recover' : 'create'
  // Prove the caller is human before any D1 access below, so a bot with no valid
  // token never reaches the database (and cannot make us send an e-mail). No-op
  // until TURNSTILE_SECRET is configured. Applies to both create and recover; it
  // runs before the account lookup, so it leaks nothing about which addresses
  // exist. Kept before normalizeEmail's throw would matter little, but placed
  // after it so an obviously bad e-mail still short-circuits without a siteverify
  // round trip.
  await verifyTurnstile(env, body?.turnstileToken, request)
  const now = Date.now()
  // Opportunistic TTL eviction of expired codes and lapsed rate-limit windows,
  // amortized onto the same requests that grow those tables. Runs after the
  // response so it never adds latency, and never affects this request's result.
  waitUntil(pruneExpiredEmailCodes(env, now))
  // Same background lane sweeps accounts whose 30-day deletion grace window has
  // elapsed. Cloudflare Pages has no cron trigger, so this stands in for a
  // scheduled job; the partial index on deletion_requested_at keeps it cheap
  // when nothing is due.
  waitUntil(purgeExpiredDeletedAccounts(env, now))
  const withinAccountLimit = await claimEmailCodeRequest(env, email, now)

  if (mode === 'recover') {
    // Send a code whenever an account exists for the address. A users row is only
    // ever created after an e-mail code was verified for that address (in
    // passkey-register-options), so its mere existence already proves mailbox
    // control; there is no need to also require a passkey. This keeps recovery
    // working for every real account, including one whose passkeys were removed
    // (an account marked for deletion) or one whose registration was abandoned
    // before the passkey ceremony; recovery simply re-enrols a passkey onto it.
    // The response is identical whether or not a code is sent, so this never
    // reveals which addresses have an account. One indexed lookup on the unique
    // e-mail, no join.
    const account = await env.DB.prepare('SELECT 1 AS ok FROM users WHERE email = ? LIMIT 1')
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
