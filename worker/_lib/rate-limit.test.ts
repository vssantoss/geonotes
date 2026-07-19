import { describe, expect, it, vi } from 'vitest'
import { enforceAuthAbuseLimit } from './rate-limit'
import { sha256Hex } from './crypto'
import type { Env } from './env'

/**
 * The auth abuse limiter is a thin wrapper, but two details in it are easy to
 * get wrong and invisible when they are: the skip path when the binding is
 * missing (which is what lets the unit suite and a stripped local config run at
 * all, and which silently disabled the limiter for the whole Pages era), and the
 * fact that the key is a hash of the caller IP rather than the IP itself.
 */

/**
 * Builds an environment with a stub rate limiter that answers with a fixed verdict.
 *
 * @param success What the binding's limit() should report.
 * @returns The Env plus the mock, for asserting the key it was called with.
 */
function envWithLimiter(success: boolean) {
  const limit = vi.fn(async () => ({ success }))
  return { env: { AUTH_RATE_LIMITER: { limit } } as unknown as Env, limit }
}

/**
 * Builds a request with an optional edge-provided caller IP.
 *
 * @param ip The CF-Connecting-IP value, or undefined to omit the header.
 * @returns The request.
 */
function requestFrom(ip?: string): Request {
  return new Request('https://gnotes.vshub.app/api/auth/email-request', {
    method: 'POST',
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  })
}

describe('auth abuse limit', () => {
  it('allows a request under the limit', async () => {
    const { env } = envWithLimiter(true)

    await expect(enforceAuthAbuseLimit(env, requestFrom('203.0.113.7'))).resolves.toBeUndefined()
  })

  it('rejects a request over the limit with 429', async () => {
    const { env } = envWithLimiter(false)

    await expect(enforceAuthAbuseLimit(env, requestFrom('203.0.113.7'))).rejects.toMatchObject({
      status: 429,
      message: 'too many requests',
    })
  })

  it('keys on a namespaced hash of the caller IP, not the IP', async () => {
    // The raw address never reaches the limiter, so the key space cannot be
    // probed for who has been active.
    const { env, limit } = envWithLimiter(true)

    await enforceAuthAbuseLimit(env, requestFrom('203.0.113.7'))

    const key = await sha256Hex('auth-source:203.0.113.7')
    expect(limit).toHaveBeenCalledWith({ key })
    expect(key).not.toContain('203.0.113.7')
  })

  it('separates two different callers', async () => {
    const { env, limit } = envWithLimiter(true)

    await enforceAuthAbuseLimit(env, requestFrom('203.0.113.7'))
    await enforceAuthAbuseLimit(env, requestFrom('198.51.100.4'))

    expect(limit.mock.calls[0]).not.toEqual(limit.mock.calls[1])
  })

  it('buckets requests with no caller IP together', async () => {
    // Only reachable locally, where the edge sets no header. Sharing one bucket
    // is deliberate: the alternative is an unkeyed limit that lets any local
    // caller exhaust everyone else's budget.
    const { env, limit } = envWithLimiter(true)

    await enforceAuthAbuseLimit(env, requestFrom())

    expect(limit).toHaveBeenCalledWith({ key: await sha256Hex('auth-source:local-or-unknown') })
  })

  it('skips the check when the binding is absent', async () => {
    // Pages could not provide this binding at all, so the guard is what kept the
    // auth routes working there. Removing it would 500 every auth request in any
    // environment without the binding.
    await expect(
      enforceAuthAbuseLimit({} as Env, requestFrom('203.0.113.7')),
    ).resolves.toBeUndefined()
  })
})
