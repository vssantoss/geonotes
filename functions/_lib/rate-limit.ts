import { HttpError } from './http'
import { sha256Hex } from './crypto'
import type { Env } from './env'

/**
 * Applies the shared authentication abuse limit to the request source.
 *
 * The native Rate Limiting binding is a Workers-only feature and is absent on
 * Cloudflare Pages, where per-IP throttling is instead enforced by a WAF Rate
 * Limiting Rule on the zone (see TODO.md). When the binding is not present we
 * skip the in-code check so the auth routes keep working rather than 500ing.
 *
 * @param env - function environment.
 * @param request - incoming authentication request.
 * @throws HttpError(429) when the source exceeds the configured limit.
 */
export async function enforceAuthAbuseLimit(env: Env, request: Request): Promise<void> {
  if (!env.AUTH_RATE_LIMITER) return
  const source = request.headers.get('CF-Connecting-IP') ?? 'local-or-unknown'
  const key = await sha256Hex(`auth-source:${source}`)
  const { success } = await env.AUTH_RATE_LIMITER.limit({ key })
  if (!success) throw new HttpError(429, 'too many requests')
}
