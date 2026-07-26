import { json, HttpError, route } from '../../../_lib/http'
import { currentSessionCredentialId, requireUser } from '../../../_lib/session'
import type { Env } from '../../../_lib/env'

/**
 * DELETE /api/auth/credentials/:id: removes one of the signed-in account's
 * passkeys. Scoped by user_id so a user can only delete their own credential.
 * Two removals are refused: the last passkey, so the account keeps a usable
 * sign-in method (409), and the passkey that signed the current session in
 * (403). The id is taken from the path.
 *
 * Blocking the in-use passkey mirrors how the current session cannot be revoked
 * from the sessions list. To remove it, sign in with another passkey first;
 * that session then names a different credential and this one becomes
 * removable. Sessions predating the credential_id column name none, so nothing
 * is blocked for them and the last-passkey rule is the only guard as before.
 */
export const onRequestDelete = route<Env>(async ({ env, request, params }) => {
  const userId = await requireUser(env, request)
  const id = typeof params.id === 'string' ? params.id : ''

  // Checked before the in-use rule: for a single-passkey account both apply, and
  // "add another first" is the more actionable of the two messages.
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  if ((count?.n ?? 0) <= 1) throw new HttpError(409, 'cannot remove last passkey')

  // Enforced here and not only by hiding the button, since the client's list can
  // be stale and the endpoint is reachable directly.
  if (id && id === (await currentSessionCredentialId(env, request))) {
    throw new HttpError(403, 'cannot remove the passkey in use')
  }

  const result = await env.DB.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  if (!result.meta.changes) throw new HttpError(404, 'no such passkey')

  return json({ ok: true })
})
