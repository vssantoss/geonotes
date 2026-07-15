import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { createSession } from '../../_lib/session'
import { consumeChallenge, PASSKEY_LOGIN_SUBJECT } from '../../_lib/challenge'
import { parseTransports } from './passkey-register-options'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-login {response, challengeToken}: finishes a
 * usernameless passkey sign-in. The user is resolved from the presented
 * credential, then a session is issued. Returns the account e-mail so the
 * client can show it (the browser never learns it from the ceremony).
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as
    | { response?: AuthenticationResponseJSON; challengeToken?: string }
    | null
  if (!body?.response || typeof body.challengeToken !== 'string') {
    throw new HttpError(400, 'bad body')
  }

  const expectedChallenge = await consumeChallenge(env, body.challengeToken, PASSKEY_LOGIN_SUBJECT)

  // The credential id identifies both the authenticator and its owner.
  const cred = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.public_key, c.counter, c.transports, u.email
       FROM credentials c JOIN users u ON u.id = c.user_id
      WHERE c.id = ?`,
  )
    .bind(body.response.id)
    .first<{
      id: string
      user_id: string
      public_key: string
      counter: number
      transports: string | null
      email: string
    }>()
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

  return json({ token: await createSession(env, cred.user_id), email: cred.email })
})
