import { json, HttpError, route } from '../../_lib/http'
import { sha256Hex } from '../../_lib/crypto'
import { getEmailSender } from '../../_lib/email'
import type { Env } from '../../_lib/env'

/** Codes expire after 10 minutes. */
const CODE_TTL_MS = 10 * 60 * 1000
/** Minimum seconds between two codes for the same address (anti-spam). */
const RESEND_COOLDOWN_MS = 60 * 1000

/**
 * POST /api/auth/email-request {email}: generates a 6-digit sign-in code,
 * stores only its hash and hands it to the e-mail sender.
 * In dev mode the code is echoed back so the flow works without a provider.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = normalizeEmail(body?.email)

  const existing = await env.DB.prepare('SELECT expires_at FROM email_codes WHERE email = ?')
    .bind(email)
    .first<{ expires_at: number }>()
  // expires_at - TTL is when the previous code was created.
  if (existing && existing.expires_at - CODE_TTL_MS > Date.now() - RESEND_COOLDOWN_MS) {
    throw new HttpError(429, 'code recently sent')
  }

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
  await env.DB.prepare(
    'INSERT OR REPLACE INTO email_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)',
  )
    .bind(email, await sha256Hex(`${code}:${email}`), Date.now() + CODE_TTL_MS)
    .run()

  await getEmailSender(env).sendCode(email, code)

  return json({ sent: true, ...(env.ENVIRONMENT === 'dev' ? { devCode: code } : {}) })
})

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
