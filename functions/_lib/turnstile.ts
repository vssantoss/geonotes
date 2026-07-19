import { HttpError } from './http'
import type { Env } from './env'

/** Cloudflare's server-side token validation endpoint. */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Upper bound on a Turnstile token; real ones are a few hundred bytes. Rejects
    oversized junk before it reaches Cloudflare. */
const MAX_TOKEN_LENGTH = 2048

/**
 * Verifies a Cloudflare Turnstile token server-side before an abuse-prone action
 * (here, sending an e-mail code) is allowed to run.
 *
 * Like the AUTH_RATE_LIMITER binding, this is a no-op when unconfigured: with no
 * TURNSTILE_SECRET set (local dev, or before the widget is provisioned) the
 * check is skipped so the flow keeps working, and the client renders no widget.
 * Once the secret is present the token becomes mandatory and a missing, oversized
 * or rejected one fails with 403. Because the client only sends a token when its
 * own sitekey is configured, always set the client sitekey (rebuild + deploy)
 * BEFORE setting this secret, or genuine requests would arrive tokenless.
 *
 * The token is single-use and short-lived. siteverify is called with the
 * caller's IP so Cloudflare can factor it into the assessment. It runs before
 * any D1 access in the handler, so a tokenless bot never reaches the database.
 * Never call siteverify from the browser: the secret must stay server-side.
 *
 * @param env - function environment (holds TURNSTILE_SECRET when configured).
 * @param token - the cf-turnstile-response value produced by the client widget.
 * @param request - the incoming request, used for the caller's IP.
 * @throws HttpError(403) when Turnstile is configured and the token is missing,
 *         malformed, or rejected by siteverify (including a siteverify outage,
 *         which fails closed rather than letting the action through unverified).
 */
export async function verifyTurnstile(env: Env, token: unknown, request: Request): Promise<void> {
  const secret = env.TURNSTILE_SECRET
  // Unconfigured: skip entirely, mirroring the rate-limit binding's no-op.
  if (!secret) return
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new HttpError(403, 'turnstile required')
  }
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  // The end-user IP sharpens Cloudflare's assessment; absent locally.
  const ip = request.headers.get('CF-Connecting-IP')
  if (ip) form.append('remoteip', ip)

  let outcome: { success?: boolean } | null = null
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form })
    outcome = (await res.json()) as { success?: boolean }
  } catch {
    // A siteverify outage fails closed: an abuse control that opens up when its
    // verifier is unreachable is no control at all.
    throw new HttpError(403, 'turnstile verification failed')
  }
  if (!outcome?.success) throw new HttpError(403, 'turnstile rejected')
}
