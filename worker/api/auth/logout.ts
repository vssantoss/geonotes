import { json, route } from '../../_lib/http'
import { destroySession } from '../../_lib/session'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/logout: revokes the session carried by the request.
 * Always succeeds; signing out an already-dead session is fine.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const response = json({ ok: true })
  response.headers.append('Set-Cookie', await destroySession(env, request))
  return response
})
