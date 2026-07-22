import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../../_lib/http'
import { consumeChallenge, expectedOrigins } from '../../../_lib/challenge'
import { requireUser } from '../../../_lib/session'
import type { Env } from '../../../_lib/env'

/** Friendly passkey names are capped so the list stays readable. */
const MAX_LABEL_LENGTH = 60

/**
 * POST /api/auth/credentials/register {response, challengeToken, label?}:
 * finishes adding a passkey to the already signed-in account. The challenge is
 * bound to the session user id, so a ceremony started for one account cannot
 * attach a credential to another. Unlike account creation this does NOT rotate
 * the session: the user stays signed in on the same session.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)
  const body = (await request.json().catch(() => null)) as
    | { response?: RegistrationResponseJSON; challengeToken?: string; label?: unknown }
    | null
  if (!body?.response || typeof body.challengeToken !== 'string') {
    throw new HttpError(400, 'bad body')
  }
  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, MAX_LABEL_LENGTH)
      : null

  const expectedChallenge = await consumeChallenge(env, body.challengeToken, userId)
  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge,
    expectedOrigin: expectedOrigins(env),
    expectedRPID: env.RP_ID,
  })
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpError(401, 'registration not verified')
  }

  const { credential } = verification.registrationInfo
  await env.DB.prepare(
    'INSERT OR REPLACE INTO credentials (id, user_id, public_key, counter, transports, created_at, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      credential.id,
      userId,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      Date.now(),
      label,
    )
    .run()

  return json({ ok: true })
})
