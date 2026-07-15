import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { createSession } from '../../_lib/session'
import { consumeChallenge } from '../../_lib/challenge'
import { normalizeEmail } from './email-request'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-register {email, response, challengeToken}: finishes
 * creating a new account, stores the credential and issues a session so the
 * user is signed in immediately. The challenge token is bound to the account's
 * id, so a mismatched e-mail cannot complete another account's registration.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; response?: RegistrationResponseJSON; challengeToken?: string }
    | null
  const email = normalizeEmail(body?.email)
  if (!body?.response || typeof body.challengeToken !== 'string') {
    throw new HttpError(400, 'bad body')
  }

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!user) throw new HttpError(400, 'no pending registration')

  const expectedChallenge = await consumeChallenge(env, body.challengeToken, user.id)
  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
  })
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpError(401, 'registration not verified')
  }

  const { credential } = verification.registrationInfo
  await env.DB.prepare(
    'INSERT OR REPLACE INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      credential.id,
      user.id,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      Date.now(),
    )
    .run()

  return json({ token: await createSession(env, user.id) })
})
