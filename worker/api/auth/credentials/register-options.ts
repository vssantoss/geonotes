import { generateRegistrationOptions } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../../_lib/http'
import { createChallenge } from '../../../_lib/challenge'
import { requireUser } from '../../../_lib/session'
import { parseTransports } from '../passkey-register-options'
import type { Env } from '../../../_lib/env'

/**
 * POST /api/auth/credentials/register-options: starts enrolling an ADDITIONAL
 * passkey for the already signed-in account. Unlike the account-creation flow
 * this needs no e-mail enroll token: the session already proves who the user
 * is. Existing credentials are excluded so the same authenticator is not
 * registered twice. The challenge is bound to the session user id.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)

  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>()
  if (!user) throw new HttpError(401, 'invalid session')

  const { results } = await env.DB.prepare(
    'SELECT id, transports FROM credentials WHERE user_id = ?',
  )
    .bind(userId)
    .all<{ id: string; transports: string | null }>()

  const options = await generateRegistrationOptions({
    rpName: 'GeoNotes',
    rpID: env.RP_ID,
    userID: Uint8Array.from(new TextEncoder().encode(userId)),
    userName: user.email,
    attestationType: 'none',
    // Keep the account's known authenticators out so the ceremony refuses to
    // enroll one that is already registered.
    excludeCredentials: results.map((c) => ({
      id: c.id,
      transports: parseTransports(c.transports) as AuthenticatorTransportFuture[] | undefined,
    })),
    // A resident (discoverable) credential is required so a later sign-in can
    // be usernameless, matching the account-creation flow.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })

  return json({ options, challengeToken: await createChallenge(env, options.challenge, userId) })
})
