import { json, route } from '../../_lib/http'
import { requireUser, buildSessionCookie } from '../../_lib/session'
import { requestAccountDeletion } from '../../_lib/account-deletion'
import { getEmailSender } from '../../_lib/email'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/delete-account: marks the signed-in account for deletion, signs
 * every device out and removes every passkey. Nothing is removed immediately;
 * the account and all its data are purged 30 days later
 * (purgeExpiredDeletedAccounts), and signing back in via "Recover account"
 * before then cancels the deletion. The response clears this device's session
 * cookie to match the sessions just revoked server-side, and a notice e-mail is
 * sent off the response path.
 */
export const onRequestPost = route<Env>(async ({ env, request, waitUntil }) => {
  const userId = await requireUser(env, request)
  const email = await requestAccountDeletion(env, userId, Date.now())
  // Best-effort courtesy notice: sent after the response so a slow or failing
  // mail provider never delays or fails the deletion itself.
  if (email) {
    waitUntil(getEmailSender(env).sendAccountDeletionNotice(email).catch(() => {}))
  }
  const response = json({ ok: true })
  response.headers.append('Set-Cookie', buildSessionCookie('', 0))
  return response
})
