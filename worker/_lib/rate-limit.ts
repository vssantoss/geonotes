import { HttpError } from './http'
import { sha256Hex } from './crypto'
import type { Env } from './env'

/**
 * Applies the shared authentication abuse limit to the request source.
 *
 * The binding is per-colo and eventually consistent, so an attacker spread
 * across colos gets the limit several times over. It is the cheap inner layer
 * that rejects before any D1 access; the zone's WAF Rate Limiting Rule remains
 * the global outer one. When the binding is not present (unit tests, a
 * stripped-down local config) we skip the check so the auth routes keep working
 * rather than 500ing.
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
