import { json, route } from '../../_lib/http'
import { requireUser } from '../../_lib/session'
import type { Env } from '../../_lib/env'

/**
 * GET /api/auth/credentials: lists the signed-in account's passkeys for the
 * settings screen. Returns each credential's id (needed to remove it), optional
 * friendly label and creation time. Never exposes public keys or other accounts.
 */
export const onRequestGet = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)
  const { results } = await env.DB.prepare(
    'SELECT id, label, created_at FROM credentials WHERE user_id = ? ORDER BY created_at',
  )
    .bind(userId)
    .all<{ id: string; label: string | null; created_at: number }>()
  return json({ credentials: results })
})
