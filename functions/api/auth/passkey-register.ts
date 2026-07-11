import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { requireUser } from '../../_lib/session'
import { verifyChallenge } from '../../_lib/challenge'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-register {response, challengeToken}: finishes
 * passkey enrollment and stores the credential's public key.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)
  const body = (await request.json().catch(() => null)) as
    | { response?: RegistrationResponseJSON; challengeToken?: string }
    | null
  if (!body?.response || typeof body.challengeToken !== 'string') {
    throw new HttpError(400, 'bad body')
  }

  const expectedChallenge = await verifyChallenge(env, body.challengeToken, userId)
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
      userId,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      Date.now(),
    )
    .run()

  return json({ ok: true })
})
