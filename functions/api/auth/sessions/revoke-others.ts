import { json, HttpError, route } from '../../../_lib/http'
import { requireUser, currentSessionHash } from '../../../_lib/session'
import type { Env } from '../../../_lib/env'

/**
 * POST /api/auth/sessions/revoke-others: "sign out everywhere else". Revokes
 * every session for the signed-in account except the caller's own, so all other
 * devices are signed out on their next request while this device stays signed
 * in. Requires the current session cookie to identify which row to keep.
 *
 * Stamps revoked_at rather than deleting, leaving a tombstone until each
 * session's natural expiry so every other device learns it was revoked (and
 * wipes its local data) instead of seeing an indistinguishable plain expiry.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)
  const thisHash = await currentSessionHash(request)
  if (!thisHash) throw new HttpError(401, 'missing token')

  await env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL',
  )
    .bind(Date.now(), userId, thisHash)
    .run()

  return json({ ok: true })
})
