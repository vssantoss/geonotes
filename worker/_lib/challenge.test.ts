import { describe, expect, it } from 'vitest'
import { expectedOrigins } from './challenge'
import type { Env } from './env'

// expectedOrigins is the one piece of WebAuthn config that changes with the
// native build: it must widen the accepted assertion origin to include the
// Android apk-key-hash without ever dropping the web origin.
describe('expectedOrigins', () => {
  const ORIGIN = 'https://gnotes.vshub.app'
  const ANDROID = 'android:apk-key-hash:_hchXF3YGzJecO0KWrVzATWXsLQal-feFgCgN56PPpg'

  /**
   * Builds a minimal Env carrying only the origin fields this helper reads.
   *
   * @param android - the Android assertion origin, or undefined to omit it.
   * @returns an Env sufficient for expectedOrigins.
   */
  function env(android?: string): Env {
    return { ORIGIN, ANDROID_PASSKEY_ORIGIN: android } as Env
  }

  it('returns the web origin only when no Android origin is configured', () => {
    expect(expectedOrigins(env())).toEqual([ORIGIN])
  })

  it('accepts both the web and Android origins when one is configured', () => {
    // Order and membership both matter: the web ceremony must still verify, and
    // the native assertion carries the apk-key-hash origin instead of https.
    expect(expectedOrigins(env(ANDROID))).toEqual([ORIGIN, ANDROID])
  })
})
