import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { json, route } from '../../_lib/http'
import { createChallenge, PASSKEY_LOGIN_SUBJECT } from '../../_lib/challenge'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/passkey-login-options: starts a usernameless passkey sign-in.
 * No e-mail is required: with no allowCredentials the browser offers any
 * discoverable (resident) credential for this relying party, and the user is
 * identified from the credential returned to /passkey-login.
 */
export const onRequestPost = route<Env>(async ({ env }) => {
  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    userVerification: 'preferred',
  })

  return json({ options, challengeToken: await createChallenge(env, options.challenge, PASSKEY_LOGIN_SUBJECT) })
})
