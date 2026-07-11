import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { json, HttpError, route } from '../../_lib/http'
import { signChallenge } from '../../_lib/challenge'
import { normalizeEmail } from './email-request'
import { parseTransports } from './passkey-register-options'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-login-options {email}: starts a passkey sign-in.
 * Responds 404 when the address has no registered passkeys so the client
 * can fall back to the e-mail code flow.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = normalizeEmail(body?.email)

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!user) throw new HttpError(404, 'no passkeys')

  const credentials = await env.DB.prepare('SELECT id, transports FROM credentials WHERE user_id = ?')
    .bind(user.id)
    .all<{ id: string; transports: string | null }>()
  if (credentials.results.length === 0) throw new HttpError(404, 'no passkeys')

  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    userVerification: 'preferred',
    allowCredentials: credentials.results.map((c) => ({
      id: c.id,
      transports: parseTransports(c.transports),
    })),
  })

  return json({ options, challengeToken: await signChallenge(env, options.challenge, user.id) })
})
