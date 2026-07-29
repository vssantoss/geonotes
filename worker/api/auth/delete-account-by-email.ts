import { json, HttpError, route } from '../../_lib/http'
import { verifyEnrollToken } from '../../_lib/enroll'
import { requestAccountDeletion } from '../../_lib/account-deletion'
import { enforceAuthAbuseLimit } from '../../_lib/rate-limit'
import { getEmailSender } from '../../_lib/email'
import type { Env } from '../../_lib/env'

/**
 * POST /api/auth/delete-account-by-email {enrollToken}: marks the account
 * belonging to a just-verified e-mail address for deletion, without a session.
 * This is what the public /delete-account page calls; the signed-in equivalent
 * is delete-account.ts, and both end in the same requestAccountDeletion, so the
 * 30-day grace window and the cancel-by-signing-back-in behaviour are identical.
 *
 * The client obtains the enroll token by running the ordinary e-mail-code flow
 * (email-request in 'recover' mode, then email-verify) against the address it
 * wants to delete. Mailbox control is the authorization, which is no weaker than
 * the in-app path: "Recover account" already lets anyone holding the mailbox
 * enrol a fresh passkey onto the account and delete it from Settings. This
 * endpoint just removes the pointless passkey ceremony from the middle.
 *
 * Nothing here can be used to discover whether an address has an account.
 * Reaching it at all requires a code, which recover mode only mails for a real
 * account, and the reply is {ok:true} either way.
 *
 * No Set-Cookie is sent: the caller is not signed in. A session for this account
 * open elsewhere in the same browser is revoked server-side by
 * requestAccountDeletion, so the SPA learns about it from the next sync
 * (SESSION_REVOKED_REASON) and wipes its local copy through its usual path.
 */
export const onRequestPost = route<Env>(async ({ env, request, waitUntil }) => {
  await enforceAuthAbuseLimit(env, request)
  const body = (await request.json().catch(() => null)) as { enrollToken?: unknown } | null
  if (typeof body?.enrollToken !== 'string') throw new HttpError(400, 'bad body')

  const email = await verifyEnrollToken(env, body.enrollToken)

  // An address with no account is answered exactly like one with an account.
  // The token proves the mailbox, not that anything was ever registered with it.
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first<{ id: string }>()
  if (user) {
    await requestAccountDeletion(env, user.id, Date.now())
    // Best-effort courtesy notice, sent after the response so a slow or failing
    // mail provider never delays or fails the deletion itself.
    waitUntil(getEmailSender(env).sendAccountDeletionNotice(email).catch(() => {}))
  }

  return json({ ok: true })
})
