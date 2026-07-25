import { json, route } from '../../_lib/http'
import { requireUser, currentSessionCredentialId } from '../../_lib/session'
import type { Env } from '../../_lib/env'

/**
 * GET /api/auth/credentials: lists the signed-in account's passkeys for the
 * settings screen. Returns each credential's id (needed to remove it), optional
 * friendly label, creation time and a `current` flag marking the passkey that
 * signed this session in. Never exposes public keys or other accounts.
 *
 * `current` means "authorized the session making this request", not "is still
 * held by this device": sessions live seven days and are never re-verified
 * against an authenticator. The flagged passkey is the one DELETE refuses to
 * remove, so the badge and that refusal read the same value and cannot disagree.
 * A session predating the credential_id column flags nothing, and blocks nothing.
 */
export const onRequestGet = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)
  const currentId = await currentSessionCredentialId(env, request)
  const { results } = await env.DB.prepare(
    'SELECT id, label, created_at FROM credentials WHERE user_id = ? ORDER BY created_at',
  )
    .bind(userId)
    .all<{ id: string; label: string | null; created_at: number }>()
  const credentials = results.map((c) => ({ ...c, current: c.id === currentId }))
  return json({ credentials })
})
