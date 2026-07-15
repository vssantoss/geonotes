import { generateRegistrationOptions } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { signChallenge } from '../../_lib/challenge'
import { verifyEnrollToken } from '../../_lib/enroll'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-register-options {enrollToken}: starts enrolling a
 * passkey onto the address the enroll token vouches for. The token is minted by
 * /api/auth/email-verify, so the address is always confirmed here; the same
 * endpoint serves both account creation (no account yet) and recovery (adding a
 * passkey to an existing account), because proving mailbox ownership authorizes
 * both. The e-mail is taken from the signed token, never from an untrusted body
 * field.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as { enrollToken?: unknown } | null
  if (typeof body?.enrollToken !== 'string') throw new HttpError(400, 'bad body')
  const email = await verifyEnrollToken(env, body.enrollToken)

  // Reuse the existing account for recovery, or create it now so the credential
  // has an owner to attach to.
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
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
