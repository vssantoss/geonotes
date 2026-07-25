import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from './env'

/**
 * Play Integrity is the native counterpart to Turnstile on the e-mail code
 * endpoint, so the same properties matter: it must stay a complete no-op while
 * unconfigured, fail closed when Google is unreachable, and only accept a token
 * that decodes to THIS app, for THIS request, recently. The module caches its
 * OAuth token in module scope, so each test re-imports it fresh via resetModules.
 */

/** A fixed request hash the token must carry; the client sets it to sha256(email). */
const HASH = 'a'.repeat(64)

/** A service-account JSON whose private key is a real generated RSA key, so the
    JWT the module signs actually verifies as importable. Built once. */
let saJson: string

/**
 * Loads a fresh copy of the module so its cached access token does not leak
 * between tests.
 *
 * @returns the module's exports.
 */
async function load() {
  vi.resetModules()
  return import('./play-integrity')
}

/**
 * Builds an environment with Play Integrity configured or not.
 *
 * @param configured whether to include the service-account secret.
 * @param strict whether to require full-strength verdicts.
 * @returns an Env carrying just those fields.
 */
function envWith(configured: boolean, strict = false): Env {
  return {
    PLAY_INTEGRITY_SA_JSON: configured ? saJson : undefined,
    PLAY_INTEGRITY_STRICT: strict ? '1' : undefined,
  } as Env
}

/**
 * The decoded payload Google's decode endpoint returns, with sensible defaults
 * that pass every non-strict check.
 *
 * @param overrides fields to replace in requestDetails/appIntegrity/deviceIntegrity.
 * @returns a decodeIntegrityToken response body.
 */
function decodeBody(overrides: {
  requestPackageName?: string
  requestHash?: string
  timestampMillis?: string
  deviceRecognitionVerdict?: string[]
  appRecognitionVerdict?: string
} = {}) {
  return {
    tokenPayloadExternal: {
      requestDetails: {
        requestPackageName: overrides.requestPackageName ?? 'app.vshub.gnotes',
        requestHash: overrides.requestHash ?? HASH,
        timestampMillis: overrides.timestampMillis ?? String(Date.now()),
      },
      appIntegrity: {
        appRecognitionVerdict: overrides.appRecognitionVerdict ?? 'UNRECOGNIZED_VERSION',
      },
      deviceIntegrity: {
        deviceRecognitionVerdict: overrides.deviceRecognitionVerdict ?? [],
      },
    },
  }
}

/**
 * Stubs global fetch, routing by URL: the OAuth token endpoint yields an access
 * token, the decode endpoint yields the supplied body.
 *
 * @param decode the decodeIntegrityToken response body, or an Error to throw.
 * @returns the fetch mock.
 */
function stubGoogle(decode: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'access-123', expires_in: 3600 }))
    }
    if (decode instanceof Error) throw decode
    return new Response(JSON.stringify(decode))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeAll(async () => {
  // Generate a real RSA key so importPrivateKey/crypto.subtle.sign succeed.
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer,
  )
  const b64 = btoa(String.fromCharCode(...pkcs8))
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`
  saJson = JSON.stringify({ client_email: 'sa@geonotes-vshub.iam.gserviceaccount.com', private_key: pem })
})

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('when unconfigured', () => {
  it('skips verification entirely', async () => {
    const fetchMock = stubGoogle(decodeBody())
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(false), undefined, HASH)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('when configured', () => {
  it('accepts a token that decodes to this app for this request', async () => {
    stubGoogle(decodeBody())
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(true), 'token', HASH)).resolves.toBeUndefined()
  })

  it.each([
    ['a missing token', undefined],
    ['a null token', null],
    ['an empty token', ''],
    ['a non-string token', 12345],
  ])('rejects %s without calling Google', async (_label, token) => {
    const fetchMock = stubGoogle(decodeBody())
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(true), token, HASH)).rejects.toMatchObject({
      status: 403,
      message: 'attestation required',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a token minted for a different app', async () => {
    stubGoogle(decodeBody({ requestPackageName: 'com.evil.app' }))
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(true), 'token', HASH)).rejects.toMatchObject({
      status: 403,
      message: 'attestation rejected',
    })
  })

  it('honours a configured ANDROID_PACKAGE over the built-in default', async () => {
    // The expected package id lives in wrangler.toml so it can follow the APK's
    // applicationId without a code change. This token would fail against the
    // built-in default, so accepting it proves the var is what is checked.
    stubGoogle(decodeBody({ requestPackageName: 'app.vshub.gnotes.beta' }))
    const { verifyPlayIntegrity } = await load()
    const env = { ...envWith(true), ANDROID_PACKAGE: 'app.vshub.gnotes.beta' } as Env

    await expect(verifyPlayIntegrity(env, 'token', HASH)).resolves.toBeUndefined()
  })

  it('rejects a token bound to a different request', async () => {
    stubGoogle(decodeBody({ requestHash: 'b'.repeat(64) }))
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(true), 'token', HASH)).rejects.toMatchObject({
      status: 403,
      message: 'attestation rejected',
    })
  })

  it('rejects a stale token outside the replay window', async () => {
    stubGoogle(decodeBody({ timestampMillis: String(Date.now() - 20 * 60 * 1000) }))
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(true), 'token', HASH)).rejects.toMatchObject({
      status: 403,
      message: 'attestation rejected',
    })
  })

  it('fails closed when the decode call errors', async () => {
    stubGoogle(new Error('network down'))
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(true), 'token', HASH)).rejects.toMatchObject({
      status: 403,
      message: 'attestation verification failed',
    })
  })

  it('fails closed when the service-account JSON is malformed', async () => {
    stubGoogle(decodeBody())
    const { verifyPlayIntegrity } = await load()
    const env = { PLAY_INTEGRITY_SA_JSON: 'not json' } as Env

    await expect(verifyPlayIntegrity(env, 'token', HASH)).rejects.toMatchObject({
      status: 403,
      message: 'attestation verification failed',
    })
  })
})

describe('strict mode', () => {
  it('rejects a debug build with no device verdict', async () => {
    stubGoogle(decodeBody())
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(true, true), 'token', HASH)).rejects.toMatchObject({
      status: 403,
      message: 'attestation rejected',
    })
  })

  it('accepts a genuine, Play-recognized install', async () => {
    stubGoogle(
      decodeBody({
        deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
        appRecognitionVerdict: 'PLAY_RECOGNIZED',
      }),
    )
    const { verifyPlayIntegrity } = await load()

    await expect(verifyPlayIntegrity(envWith(true, true), 'token', HASH)).resolves.toBeUndefined()
  })
})
