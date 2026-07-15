import { HttpError } from './http'
import { sha256Hex } from './crypto'
import type { Env } from './env'

/**
 * Applies the shared authentication abuse limit to the request source.
 *
 * @param env - function environment.
 * @param request - incoming authentication request.
 * @throws HttpError(429) when the source exceeds the configured limit.
 */
export async function enforceAuthAbuseLimit(env: Env, request: Request): Promise<void> {
  const source = request.headers.get('CF-Connecting-IP') ?? 'local-or-unknown'
  const key = await sha256Hex(`auth-source:${source}`)
  const { success } = await env.AUTH_RATE_LIMITER.limit({ key })
  if (!success) throw new HttpError(429, 'too many requests')
}
