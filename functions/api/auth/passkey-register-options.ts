import { generateRegistrationOptions } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { signChallenge } from '../../_lib/challenge'
import { normalizeEmail } from './email-request'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-register-options {email}: starts creating a new
 * account with a passkey. No session is required: proving control of a fresh
 * authenticator is the registration. The e-mail is recorded for future account
 * recovery (not built yet) but is not verified here.
 *
 * An address that already has a passkey is rejected: since the e-mail is
 * unverified, enrolling onto it would let anyone who knows the address hijack
 * the account. A real owner's recovery path is intentionally deferred.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = normalizeEmail(body?.email)

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (user) {
    const creds = await env.DB.prepare('SELECT count(*) AS n FROM credentials WHERE user_id = ?')
      .bind(user.id)
      .first<{ n: number }>()
    if ((creds?.n ?? 0) > 0) throw new HttpError(409, 'account exists')
  }

  // Reuse an orphan row (an earlier attempt that never completed a passkey)
  // or create the account now so the credential has an owner to attach to.
  const userId = user?.id ?? crypto.randomUUID()
  if (!user) {
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .bind(userId, email, Date.now())
      .run()
  }

  const options = await generateRegistrationOptions({
    rpName: 'GeoNotes',
    rpID: env.RP_ID,
    userID: Uint8Array.from(new TextEncoder().encode(userId)),
    userName: email,
    attestationType: 'none',
    // A resident (discoverable) credential is required so the later sign-in can
    // be usernameless.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
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
