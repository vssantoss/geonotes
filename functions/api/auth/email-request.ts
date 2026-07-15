import { json, HttpError, route } from '../../_lib/http'
import { sha256Hex } from '../../_lib/crypto'
import { getEmailSender } from '../../_lib/email'
import type { Env } from '../../_lib/env'

/** Codes expire after 10 minutes. */
const CODE_TTL_MS = 10 * 60 * 1000
/** Minimum seconds between two codes for the same address (anti-spam). */
const RESEND_COOLDOWN_MS = 60 * 1000

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
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; mode?: unknown }
    | null
  const email = normalizeEmail(body?.email)
  const mode = body?.mode === 'recover' ? 'recover' : 'create'

  if (mode === 'recover') {
    const account = await env.DB.prepare(
      'SELECT 1 AS ok FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.email = ? LIMIT 1',
    )
      .bind(email)
      .first<{ ok: number }>()
    // Send only for a real account and only when not in cooldown, but always
    // answer identically so nothing distinguishes the cases in production.
    const code = account && !(await recentlySent(env, email)) ? await issueCode(env, email) : null
    return json({ sent: true, ...(env.ENVIRONMENT === 'dev' && code ? { devCode: code } : {}) })
  }

  if (await recentlySent(env, email)) throw new HttpError(429, 'code recently sent')
  const code = await issueCode(env, email)
  return json({ sent: true, ...(env.ENVIRONMENT === 'dev' ? { devCode: code } : {}) })
})

/**
 * Reports whether a code for this address was sent within the resend cooldown.
 *
 * @param env - function environment.
 * @param email - canonicalized address.
 * @returns true when another code was issued less than the cooldown ago.
 */
async function recentlySent(env: Env, email: string): Promise<boolean> {
  const existing = await env.DB.prepare('SELECT expires_at FROM email_codes WHERE email = ?')
    .bind(email)
    .first<{ expires_at: number }>()
  // expires_at - TTL is when the previous code was created.
  return !!existing && existing.expires_at - CODE_TTL_MS > Date.now() - RESEND_COOLDOWN_MS
}

/**
 * Generates a fresh code, stores only its hash and e-mails it.
 *
 * @param env - function environment.
 * @param email - canonicalized recipient address.
 * @returns the plaintext code (for the dev echo only).
 */
async function issueCode(env: Env, email: string): Promise<string> {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
  await env.DB.prepare(
    'INSERT OR REPLACE INTO email_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)',
  )
    .bind(email, await sha256Hex(`${code}:${email}`), Date.now() + CODE_TTL_MS)
    .run()
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
