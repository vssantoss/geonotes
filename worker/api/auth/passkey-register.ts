import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { createSession } from '../../_lib/session'
import { isNativeOrigin } from '../../_lib/cors'
import { consumeChallenge, expectedOrigins } from '../../_lib/challenge'
import { getEmailSender } from '../../_lib/email'
import { normalizeEmail } from './email-request'
import type { Env } from '../../_lib/env'

/**
 * A new account's row is created in passkey-register-options and its first
 * credential is enrolled here moments later, so a genuinely new account is at
 * most this old when this endpoint runs. Recovery targets an existing (older)
 * account, so this age bound keeps the welcome e-mail to first-time creations.
 */
const NEW_ACCOUNT_MAX_AGE_MS = 60 * 60 * 1000

/**
 * POST /api/auth/passkey-register {email, response, challengeToken}: finishes
 * creating a new account, stores the credential and issues a session so the
 * user is signed in immediately. The challenge token is bound to the account's
 * id, so a mismatched e-mail cannot complete another account's registration.
 *
 * The same endpoint also completes recovery (re-enrolling a passkey onto an
 * existing account), so the welcome e-mail is sent only when this is the
 * account's first credential and the account was just created.
 */
export const onRequestPost = route<Env>(async ({ env, request, waitUntil }) => {
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; response?: RegistrationResponseJSON; challengeToken?: string }
    | null
  const email = normalizeEmail(body?.email)
  if (!body?.response || typeof body.challengeToken !== 'string') {
    throw new HttpError(400, 'bad body')
  }

  const user = await env.DB.prepare('SELECT id, created_at FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; created_at: number }>()
  if (!user) throw new HttpError(400, 'no pending registration')

  // A new account has no credential yet; recovery re-enrols onto one that either
  // still has credentials or is an older row. Read this before the insert below.
  const existingCredential = await env.DB.prepare(
    'SELECT 1 AS ok FROM credentials WHERE user_id = ? LIMIT 1',
  )
    .bind(user.id)
    .first<{ ok: number }>()
  const isNewAccount =
    !existingCredential && Date.now() - user.created_at < NEW_ACCOUNT_MAX_AGE_MS

  const expectedChallenge = await consumeChallenge(env, body.challengeToken, user.id)
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

  // Best-effort welcome, sent after the response so a slow or failing mail
  // provider never delays or fails the registration itself.
  if (isNewAccount) {
    waitUntil(getEmailSender(env).sendWelcome(email).catch(() => {}))
  }

  // Web stores the session in the cookie; native also gets the raw token in the
  // body for its bearer transport (never returned to web, where it must stay
  // HttpOnly). See passkey-login for the same split.
  const { token, cookie } = await createSession(env, user.id, request)
  const response = json({ ok: true, ...(isNativeOrigin(request) ? { token } : {}) })
  response.headers.append('Set-Cookie', cookie)
  return response
})
