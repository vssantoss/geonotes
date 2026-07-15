import { json, HttpError, route } from '../../../_lib/http'
import { requireUser } from '../../../_lib/session'
import type { Env } from '../../../_lib/env'

/**
 * DELETE /api/auth/credentials/:id: removes one of the signed-in account's
 * passkeys. Scoped by user_id so a user can only delete their own credential,
 * and refuses to remove the last passkey so the account keeps a usable sign-in
 * method (409). The id is taken from the path.
 */
export const onRequestDelete = route<Env>(async ({ env, request, params }) => {
  const userId = await requireUser(env, request)
  const id = typeof params.id === 'string' ? params.id : ''

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  if ((count?.n ?? 0) <= 1) throw new HttpError(409, 'cannot remove last passkey')

  const result = await env.DB.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  if (!result.meta.changes) throw new HttpError(404, 'no such passkey')

  return json({ ok: true })
})
