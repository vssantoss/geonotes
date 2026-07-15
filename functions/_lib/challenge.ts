import { randomHex } from './crypto'
import { HttpError } from './http'
import type { Env } from './env'

// Server-side WebAuthn challenges. Each ceremony's challenge is stored in D1
// under a random ceremony id (the challenge token). Verification deletes the
// row in the same statement it reads it, so a captured (token, passkey
// response) pair can be replayed at most zero further times: the second
// attempt finds no row. This closes the replay window that stateless
// HMAC-signed tokens left open.

/** Challenges are valid for 5 minutes, enough for one ceremony. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000

/** Fixed challenge subject for usernameless passkey login: the user is
    identified from the discoverable credential they present, not from a
    subject known up front, so the challenge is bound to this constant instead. */
export const PASSKEY_LOGIN_SUBJECT = 'passkey-login'

/**
 * Stores a challenge for a subject (user id or the login constant) and returns
 * an opaque single-use token identifying the ceremony.
 *
 * @param env - function environment (uses DB).
 * @param challenge - the base64url challenge from simplewebauthn.
 * @param subject - who the ceremony is for; verified on the way back.
 * @returns the ceremony token to hand to the client.
 */
export async function createChallenge(env: Env, challenge: string, subject: string): Promise<string> {
  const id = randomHex(32)
  const now = Date.now()
  // Opportunistically drop expired ceremonies so the table stays small; this
  // is a bounded delete on an indexed column, not a full scan.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now),
    env.DB.prepare(
      'INSERT INTO webauthn_challenges (id, challenge, subject, expires_at) VALUES (?, ?, ?, ?)',
    ).bind(id, challenge, subject, now + CHALLENGE_TTL_MS),
  ])
  return id
}

/**
 * Consumes a challenge token, deleting it so it can never be used again, and
 * returns the challenge it stood for.
 *
 * @param env - function environment (uses DB).
 * @param token - the token produced by createChallenge.
 * @param subject - must equal the subject the challenge was issued for.
 * @returns the original base64url challenge.
 * @throws HttpError(401) when the token is unknown, already used, expired, or
 *         issued for a different subject.
 */
export async function consumeChallenge(env: Env, token: string, subject: string): Promise<string> {
  // Delete and read in one statement so concurrent replays cannot both see the
  // row: SQLite serializes writes, so exactly one caller gets the returned row.
  const row = await env.DB.prepare(
    'DELETE FROM webauthn_challenges WHERE id = ? RETURNING challenge, subject, expires_at',
  )
    .bind(token)
    .first<{ challenge: string; subject: string; expires_at: number }>()
  if (!row) throw new HttpError(401, 'bad challenge token')
  if (row.subject !== subject || row.expires_at < Date.now()) {
    throw new HttpError(401, 'challenge expired')
  }
  return row.challenge
}
