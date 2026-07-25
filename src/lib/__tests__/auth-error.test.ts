import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, apiFetch } from '../api'
import { authErrorKey } from '../auth-error'

// api.ts reaches the native session store on import; neither plugin has a
// runtime here, and the web path (not native) never calls into them anyway.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))
vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {},
}))

/** Stubs navigator.onLine, which does not exist in the Node test environment. */
function setOnline(online: boolean) {
  vi.stubGlobal('navigator', { onLine: online })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch failures', () => {
  it('reports a rejected fetch as a NetworkError, not a server error', async () => {
    setOnline(false)
    // What a fetch does with no network: it rejects, rather than resolving with
    // a status the caller could inspect.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const err = await apiFetch('/api/auth/passkey-login-options', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect((err as NetworkError).offline).toBe(true)
  })

  it('keeps a server answer an ApiError even when it is a 500', async () => {
    setOnline(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    )
    const err = await apiFetch('/api/sync', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })

  it('records connectivity as it was when the request failed', async () => {
    setOnline(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const err = (await apiFetch('/api/sync', {}).catch((e: unknown) => e)) as NetworkError
    // Connectivity returning afterwards must not rewrite what happened.
    setOnline(false)
    expect(err.offline).toBe(false)
  })
})

describe('authErrorKey', () => {
  it('names the missing connection when the device was offline', () => {
    setOnline(false)
    expect(authErrorKey(new NetworkError(new TypeError('Failed to fetch')))).toBe(
      'auth.error.offline',
    )
  })

  it('says the server was unreachable when the device believed it was online', () => {
    // A captive portal or an outage: telling this user they are offline would
    // send them to fix a connection that is already up.
    setOnline(true)
    expect(authErrorKey(new NetworkError(new TypeError('Failed to fetch')))).toBe(
      'auth.error.unreachable',
    )
  })

  it('passes through the caller fallback for a server answer', () => {
    expect(authErrorKey(new ApiError(401, 'invalid session'), 'auth.error.badCode')).toBe(
      'auth.error.badCode',
    )
  })

  it('defaults to the generic message for anything else', () => {
    expect(authErrorKey(new Error('boom'))).toBe('auth.error.generic')
  })
})
