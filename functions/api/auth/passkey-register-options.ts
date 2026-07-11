import { generateRegistrationOptions } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { requireUser } from '../../_lib/session'
import { signChallenge } from '../../_lib/challenge'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-register-options: starts passkey enrollment for the
 * signed-in user. The challenge comes back HMAC-signed so no server state
 * (and no D1 write) is needed between the two ceremony halves.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)

  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>()
  if (!user) throw new HttpError(401, 'unknown user')

  const existing = await env.DB.prepare('SELECT id, transports FROM credentials WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string; transports: string | null }>()

  const options = await generateRegistrationOptions({
    rpName: 'GeoNotes',
    rpID: env.RP_ID,
    userID: Uint8Array.from(new TextEncoder().encode(userId)),
    userName: user.email,
    attestationType: 'none',
    // Prevents registering the same authenticator twice.
    excludeCredentials: existing.results.map((c) => ({
      id: c.id,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })

  return json({ options, challengeToken: await signChallenge(env, options.challenge, userId) })
})

/**
 * Parses the JSON-encoded transports column.
 *
 * @param raw - the column value.
 * @returns the transports array, or undefined when absent.
 */
export function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as AuthenticatorTransportFuture[]
  } catch {
    return undefined
  }
}
