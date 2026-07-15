import { json, HttpError, route } from '../../../_lib/http'
import { requireUser } from '../../../_lib/session'
import type { Env } from '../../../_lib/env'

/**
 * DELETE /api/auth/sessions/:id: revokes one of the signed-in account's
 * sessions, signing out that device on its next request. Scoped by user_id so a
 * user can only revoke their own sessions. Revoking the current session is
 * allowed (the client treats it as a local sign-out). The id is taken from the
 * path.
 *
 * Stamps revoked_at rather than deleting the row, leaving a tombstone until the
 * session's natural expiry so the revoked device learns it was revoked (and
 * wipes its local data) instead of seeing an indistinguishable plain expiry.
 */
export const onRequestDelete = route<Env>(async ({ env, request, params }) => {
  const userId = await requireUser(env, request)
  const id = typeof params.id === 'string' ? params.id : ''

  const result = await env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  )
    .bind(Date.now(), id, userId)
    .run()
  if (!result.meta.changes) throw new HttpError(404, 'no such session')

  return json({ ok: true })
})
