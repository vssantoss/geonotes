import { hmacSign, timingSafeEqual, toBase64Url } from './crypto'
import { HttpError } from './http'
import type { Env } from './env'

// Stateless proof-of-e-mail-ownership tokens. Verifying an e-mail code mints
// one of these; the passkey-registration endpoints require it before enrolling
// a credential, so nobody can attach a passkey to an address they do not own.
// They are HMAC-signed and carry no server state, costing zero database
// transactions. WebAuthn challenge tokens used to work the same way but no
// longer do: they are D1 rows now (see challenge.ts), because a challenge must
// be single-use and a stateless token cannot be revoked once issued. Enroll
// tokens keep the stateless form deliberately, accepting reuse within their
// 10-minute window in exchange for costing nothing.
//
// This is the only consumer of AUTH_SECRET. Rotating that secret invalidates
// enroll tokens already in flight and nothing else: stored credentials are
// public keys in D1, and sessions are opaque D1 tokens.

/** An enroll token is valid for 10 minutes: enough to complete a passkey ceremony. */
const ENROLL_TTL_MS = 10 * 60 * 1000

/**
 * Signs a proof that the given e-mail was just verified via a code.
 *
 * @param env - function environment (uses AUTH_SECRET).
 * @param email - the canonicalized address that was verified.
 * @returns an opaque token: base64url(payload) + '.' + signature.
 */
export async function signEnrollToken(env: Env, email: string): Promise<string> {
  const payload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ email, exp: Date.now() + ENROLL_TTL_MS })),
  )
  return `${payload}.${await hmacSign(env.AUTH_SECRET, payload)}`
}

/**
 * Verifies an enroll token and extracts the e-mail it vouches for.
 *
 * @param env - function environment (uses AUTH_SECRET).
 * @param token - the token produced by signEnrollToken.
 * @returns the verified e-mail address.
 * @throws HttpError(401) on tampering or expiry.
 */
export async function verifyEnrollToken(env: Env, token: string): Promise<string> {
  const [payload, sig] = token.split('.')
  if (!payload || !sig || !timingSafeEqual(sig, await hmacSign(env.AUTH_SECRET, payload))) {
    throw new HttpError(401, 'bad enroll token')
  }
  const parsed = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(payload.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)),
    ),
  ) as { email: string; exp: number }
  if (parsed.exp < Date.now()) throw new HttpError(401, 'enroll token expired')
  return parsed.email
}
