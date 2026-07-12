import { hmacSign, timingSafeEqual, toBase64Url } from './crypto'
import { HttpError } from './http'
import type { Env } from './env'

// Stateless WebAuthn challenge tokens: the challenge is HMAC-signed and
// round-tripped through the client instead of being stored in D1. This costs
// zero database transactions per ceremony.

/** Challenge tokens are valid for 5 minutes, enough for one ceremony. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000

/** Fixed challenge subject for usernameless passkey login: the user is
    identified from the discoverable credential they present, not from a
    subject known up front, so the token is bound to this constant instead. */
export const PASSKEY_LOGIN_SUBJECT = 'passkey-login'

/**
 * Signs a challenge for a subject (user id or e-mail).
 *
 * @param env - function environment (uses AUTH_SECRET).
 * @param challenge - the base64url challenge from simplewebauthn.
 * @param subject - who the ceremony is for; verified on the way back.
 * @returns an opaque token: base64url(payload) + '.' + signature.
 */
export async function signChallenge(env: Env, challenge: string, subject: string): Promise<string> {
  const payload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ challenge, subject, exp: Date.now() + CHALLENGE_TTL_MS })),
  )
  return `${payload}.${await hmacSign(env.AUTH_SECRET, payload)}`
}

/**
 * Verifies a challenge token and extracts the challenge.
 *
 * @param env - function environment (uses AUTH_SECRET).
 * @param token - the token produced by signChallenge.
 * @param subject - must equal the subject the token was issued for.
 * @returns the original base64url challenge.
 * @throws HttpError(401) on tampering, subject mismatch or expiry.
 */
export async function verifyChallenge(env: Env, token: string, subject: string): Promise<string> {
  const [payload, sig] = token.split('.')
  if (!payload || !sig || !timingSafeEqual(sig, await hmacSign(env.AUTH_SECRET, payload))) {
    throw new HttpError(401, 'bad challenge token')
  }
  const parsed = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(payload.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)),
    ),
  ) as { challenge: string; subject: string; exp: number }
  if (parsed.subject !== subject || parsed.exp < Date.now()) {
    throw new HttpError(401, 'challenge expired')
  }
  return parsed.challenge
}
