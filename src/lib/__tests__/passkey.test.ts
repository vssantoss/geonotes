import { beforeEach, describe, expect, it, vi } from 'vitest'

const isNativePlatform = vi.fn(() => false)
// Typed so the mock factories below return a known type: an untyped vi.fn()
// yields `any`, which the type-checked lint rules reject at the return sites.
const createCredential = vi.fn<(opts: unknown) => Promise<unknown>>()
const startRegistration = vi.fn<(opts: unknown) => Promise<unknown>>()

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}))
vi.mock('@capgo/capacitor-passkey', () => ({
  CapacitorPasskey: { createCredential: (opts: unknown) => createCredential(opts) },
}))
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (opts: unknown) => startRegistration(opts),
  startAuthentication: vi.fn(),
}))

const { passkeyCreate, PasskeyDuplicateError } = await import('../passkey')

/**
 * The duplicate-passkey refusal is the same WebAuthn condition on both
 * platforms but arrives as two unrelated JavaScript objects: a real DOMException
 * in the browser, and a plain Capacitor bridge error carrying the DOM error name
 * in `code`/`data.name` on Android. The bug this covers was an
 * `instanceof DOMException` test that only ever matched the web shape, so a
 * native duplicate fell through to the generic "something went wrong" message.
 */

beforeEach(() => {
  vi.clearAllMocks()
  isNativePlatform.mockReturnValue(false)
})

/** Minimal creation options; the ceremony is mocked, so contents do not matter. */
const options = { challenge: 'x', rp: { id: 'gnotes.vshub.app', name: 'GeoNotes' } } as never

describe('passkeyCreate duplicate handling', () => {
  it('normalises the browser DOMException', async () => {
    startRegistration.mockRejectedValue(new DOMException('excluded', 'InvalidStateError'))

    await expect(passkeyCreate(options)).rejects.toBeInstanceOf(PasskeyDuplicateError)
  })

  it('normalises the native bridge error, which is not a DOMException', async () => {
    // The exact shape logged by the plugin: call.reject(message, name, ...) puts
    // the DomError simple name in `code` and mirrors it in `data.name`.
    const err = Object.assign(new Error('One of the excluded credentials exists on the local device.'), {
      code: 'InvalidStateError',
      data: { name: 'InvalidStateError' },
    })
    isNativePlatform.mockReturnValue(true)
    createCredential.mockRejectedValue(err)

    await expect(passkeyCreate(options)).rejects.toBeInstanceOf(PasskeyDuplicateError)
  })

  it('reads data.name when the bridge omits code', async () => {
    isNativePlatform.mockReturnValue(true)
    createCredential.mockRejectedValue(
      Object.assign(new Error('nope'), { data: { name: 'InvalidStateError' } }),
    )

    await expect(passkeyCreate(options)).rejects.toBeInstanceOf(PasskeyDuplicateError)
  })

  it('leaves a web cancellation alone so the caller can stay silent', async () => {
    const cancel = new DOMException('cancelled', 'NotAllowedError')
    startRegistration.mockRejectedValue(cancel)

    await expect(passkeyCreate(options)).rejects.toBe(cancel)
  })

  it('leaves an unrelated native failure alone', async () => {
    // A native cancel currently reaches here as UnknownError, indistinguishable
    // from a genuine failure by code, so it must not be claimed as a duplicate.
    const failure = Object.assign(new Error('boom'), {
      code: 'UnknownError',
      data: { name: 'UnknownError' },
    })
    isNativePlatform.mockReturnValue(true)
    createCredential.mockRejectedValue(failure)

    await expect(passkeyCreate(options)).rejects.toBe(failure)
  })

  it('does not mistake a null rejection for a duplicate', async () => {
    startRegistration.mockRejectedValue(null)

    await expect(passkeyCreate(options)).rejects.toBeNull()
  })
})
