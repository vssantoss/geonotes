import { json, route } from '../../_lib/http'
import { requireUser, currentSessionHash } from '../../_lib/session'
import type { Env } from '../../_lib/env'

/**
 * GET /api/auth/sessions: lists the signed-in account's active sessions for the
 * settings screen. Each row carries its public id (to revoke it), when it was
 * created and last used, the raw user agent (the client derives a device label)
 * and a `current` flag marking the caller's own session. Token hashes are never
 * returned. Sessions predating the metadata migration have null id/timestamps.
 */
export const onRequestGet = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)
  const thisHash = await currentSessionHash(request)
  // Only genuinely active sessions: revoked tombstones and expired rows linger
  // until swept but must not appear in the list.
  const { results } = await env.DB.prepare(
    'SELECT id, token_hash, created_at, last_seen, user_agent, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen DESC',
  )
    .bind(userId, Date.now())
    .all<{
      id: string | null
      token_hash: string
      created_at: number | null
      last_seen: number | null
      user_agent: string | null
      expires_at: number
    }>()

  const sessions = results.map((s) => ({
    id: s.id,
    createdAt: s.created_at,
    lastSeen: s.last_seen,
    userAgent: s.user_agent,
    expiresAt: s.expires_at,
    // Marked from the token hash so the UI can label "this device" and keep it
    // out of the revocable list without ever exposing the hash itself.
    current: s.token_hash === thisHash,
  }))
  return json({ sessions })
})
