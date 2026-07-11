import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { createSession } from '../../_lib/session'
import { verifyChallenge } from '../../_lib/challenge'
import { normalizeEmail } from './email-request'
import { parseTransports } from './passkey-register-options'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-login {email, response, challengeToken}: finishes a
 * passkey sign-in and issues a session.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; response?: AuthenticationResponseJSON; challengeToken?: string }
    | null
  const email = normalizeEmail(body?.email)
  if (!body?.response || typeof body.challengeToken !== 'string') {
    throw new HttpError(400, 'bad body')
  }

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!user) throw new HttpError(401, 'auth failed')

  const expectedChallenge = await verifyChallenge(env, body.challengeToken, user.id)

  const cred = await env.DB.prepare(
    'SELECT id, public_key, counter, transports FROM credentials WHERE id = ? AND user_id = ?',
  )
    .bind(body.response.id, user.id)
    .first<{ id: string; public_key: string; counter: number; transports: string | null }>()
  if (!cred) throw new HttpError(401, 'auth failed')

  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
    credential: {
      id: cred.id,
      publicKey: isoBase64URL.toBuffer(cred.public_key),
      counter: cred.counter,
      transports: parseTransports(cred.transports),
    },
  })
  if (!verification.verified) throw new HttpError(401, 'auth failed')

  // The signature counter detects cloned authenticators on devices that
  // implement it (many platform authenticators always report 0).
  await env.DB.prepare('UPDATE credentials SET counter = ? WHERE id = ?')
    .bind(verification.authenticationInfo.newCounter, cred.id)
    .run()

  return json({ token: await createSession(env, user.id) })
})
