import { sha256Hex } from './crypto'
import type { Env } from './env'

/** Maximum number of code requests for one address in a limit window. */
const MAX_REQUESTS_PER_WINDOW = 5
/** Per-address request limit window. */
const REQUEST_WINDOW_MS = 60 * 60 * 1000
/** Codes expire after 10 minutes. */
const CODE_TTL_MS = 10 * 60 * 1000
/** Minimum time between two codes for the same address. */
const RESEND_COOLDOWN_MS = 60 * 1000
/** A code is burned after this many verification attempts. */
const MAX_VERIFY_ATTEMPTS = 5

/** Stored data returned after an atomic verification-attempt claim. */
export interface ClaimedEmailCode {
  codeHash: string
}

/**
 * Claims one request from an address's fixed rate-limit window.
 *
 * @param env - function environment.
 * @param email - canonicalized address.
 * @param now - current epoch timestamp.
 * @returns true when the request is within the limit.
 */
export async function claimEmailCodeRequest(env: Env, email: string, now: number): Promise<boolean> {
  const cutoff = now - REQUEST_WINDOW_MS
  const row = await env.DB.prepare(
    `INSERT INTO email_code_rate_limits (email, window_started_at, requests)
     VALUES (?, ?, 1)
     ON CONFLICT(email) DO UPDATE SET
       window_started_at = CASE
         WHEN email_code_rate_limits.window_started_at <= ? THEN excluded.window_started_at
         ELSE email_code_rate_limits.window_started_at
       END,
       requests = CASE
         WHEN email_code_rate_limits.window_started_at <= ? THEN 1
         ELSE email_code_rate_limits.requests + 1
       END
     WHERE email_code_rate_limits.window_started_at <= ?
        OR email_code_rate_limits.requests < ?
     RETURNING requests`,
  )
    .bind(email, now, cutoff, cutoff, cutoff, MAX_REQUESTS_PER_WINDOW)
    .first<{ requests: number }>()
  return row !== null
}

/**
 * Atomically stores a fresh code only when the address cooldown has elapsed.
 *
 * @param env - function environment.
 * @param email - canonicalized address.
 * @param now - current epoch timestamp.
 * @returns the plaintext code when issued, otherwise null.
 */
export async function issueEmailCode(env: Env, email: string, now: number): Promise<string | null> {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
  const codeHash = await sha256Hex(`${code}:${email}`)
  const row = await env.DB.prepare(
    `INSERT INTO email_codes (email, code_hash, expires_at, attempts)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0
     WHERE email_codes.expires_at - ? <= ?
     RETURNING code_hash`,
  )
    .bind(email, codeHash, now + CODE_TTL_MS, CODE_TTL_MS, now - RESEND_COOLDOWN_MS)
    .first<{ code_hash: string }>()
  return row ? code : null
}

/**
 * Atomically spends one verification attempt and returns the stored code hash.
 *
 * @param env - function environment.
 * @param email - canonicalized address.
 * @param now - current epoch timestamp.
 * @returns the claimed code hash, or null for missing, expired, or exhausted codes.
 */
export async function claimEmailCodeAttempt(
  env: Env,
  email: string,
  now: number,
): Promise<ClaimedEmailCode | null> {
  const row = await env.DB.prepare(
    `UPDATE email_codes
        SET attempts = attempts + 1
      WHERE email = ? AND expires_at >= ? AND attempts < ?
      RETURNING code_hash`,
  )
    .bind(email, now, MAX_VERIFY_ATTEMPTS)
    .first<{ code_hash: string }>()
  return row ? { codeHash: row.code_hash } : null
}

/**
 * Consumes a matching code exactly once after its hash has been verified.
 *
 * @param env - function environment.
 * @param email - canonicalized address.
 * @param codeHash - hash claimed by the verification request.
 * @returns true only for the request that deleted the code row.
 */
export async function consumeEmailCode(env: Env, email: string, codeHash: string): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM email_codes WHERE email = ? AND code_hash = ?')
    .bind(email, codeHash)
    .run()
  return result.meta.changes === 1
}
