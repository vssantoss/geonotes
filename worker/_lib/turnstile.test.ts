import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyTurnstile } from './turnstile'
import type { Env } from './env'

/**
 * Turnstile verification is the outermost gate on the e-mail code endpoint, so
 * its failure modes matter more than its happy path: it has to fail closed when
 * siteverify is unreachable, and it has to stay a complete no-op while the
 * secret is unset, or local dev and the pre-provisioning window would break.
 */

const SECRET = 'test-secret'

/**
 * Builds an environment with Turnstile configured or not.
 *
 * @param secret The TURNSTILE_SECRET value, or undefined to leave it unset.
 * @returns An Env carrying just that field.
 */
function envWith(secret?: string): Env {
  return { TURNSTILE_SECRET: secret } as Env
}

/**
 * Stubs global fetch with a canned siteverify outcome and records the call.
 *
 * @param outcome JSON body siteverify should answer with.
 * @returns The vitest mock, for asserting what was sent.
 */
function stubSiteverify(outcome: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(outcome)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** A request carrying the caller IP header Cloudflare sets at the edge. */
const request = new Request('https://gnotes.vshub.app/api/auth/email-request', {
  method: 'POST',
  headers: { 'CF-Connecting-IP': '203.0.113.7' },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('when unconfigured', () => {
  it('skips verification entirely', async () => {
    // Before the secret is provisioned the client renders no widget, so genuine
    // requests arrive tokenless and must still work.
    const fetchMock = stubSiteverify({ success: false })

    await expect(verifyTurnstile(envWith(), undefined, request)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('when configured', () => {
  it('accepts a token siteverify approves', async () => {
    stubSiteverify({ success: true })

    await expect(verifyTurnstile(envWith(SECRET), 'good-token', request)).resolves.toBeUndefined()
  })

  it('sends the secret, the token and the caller IP', async () => {
    const fetchMock = stubSiteverify({ success: true })

    await verifyTurnstile(envWith(SECRET), 'good-token', request)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    const body = init.body as FormData
    expect(body.get('secret')).toBe(SECRET)
    expect(body.get('response')).toBe('good-token')
    expect(body.get('remoteip')).toBe('203.0.113.7')
  })

  it('omits the caller IP when there is none', async () => {
    const fetchMock = stubSiteverify({ success: true })
    const local = new Request('https://gnotes.vshub.app/api/auth/email-request', { method: 'POST' })

    await verifyTurnstile(envWith(SECRET), 'good-token', local)

    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBeInstanceOf(
      FormData,
    )
    expect(
      ((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get(
        'remoteip',
      ),
    ).toBeNull()
  })

  it('rejects a token siteverify refuses', async () => {
    stubSiteverify({ success: false })

    await expect(verifyTurnstile(envWith(SECRET), 'bad-token', request)).rejects.toMatchObject({
      status: 403,
      message: 'turnstile rejected',
    })
  })

  it.each([
    ['a missing token', undefined],
    ['a null token', null],
    ['an empty token', ''],
    ['a non-string token', 12345],
  ])('rejects %s without calling siteverify', async (_label, token) => {
    const fetchMock = stubSiteverify({ success: true })

    await expect(verifyTurnstile(envWith(SECRET), token, request)).rejects.toMatchObject({
      status: 403,
      message: 'turnstile required',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an oversized token before it reaches Cloudflare', async () => {
    // Real tokens are a few hundred bytes; the cap keeps junk payloads off
    // Cloudflare's endpoint rather than proxying them.
    const fetchMock = stubSiteverify({ success: true })

    await expect(
      verifyTurnstile(envWith(SECRET), 'x'.repeat(2049), request),
    ).rejects.toMatchObject({ status: 403, message: 'turnstile required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when siteverify is unreachable', async () => {
    // An abuse control that opens up when its verifier is down is no control at
    // all, so a network error must reject rather than pass the request through.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    await expect(verifyTurnstile(envWith(SECRET), 'good-token', request)).rejects.toMatchObject({
      status: 403,
      message: 'turnstile verification failed',
    })
  })

  it('fails closed when siteverify answers with non-JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>')))

    await expect(verifyTurnstile(envWith(SECRET), 'good-token', request)).rejects.toMatchObject({
      status: 403,
      message: 'turnstile verification failed',
    })
  })
})
