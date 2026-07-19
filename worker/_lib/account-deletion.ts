import type { Env } from './env'

// Server-side account-deletion lifecycle. Deleting an account is a two-phase,
// soft-delete flow: requesting deletion only marks the user row and signs every
// device out; the account and all its data are removed for real 30 days later by
// purgeExpiredDeletedAccounts. Signing back in during the window cancels the
// deletion (see the deletion_requested_at clear in session.ts createSession).

/** How long a marked-for-deletion account is retained before it is purged. The
    grace window lets a user undo an accidental deletion by signing back in, and
    keeps the e-mail reserved (the user row lives on) until then. */
export const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Marks an account for deletion, signs out every device and removes every
 * passkey.
 *
 * The user row is kept (only stamped with the request time) so the address stays
 * reserved and the deletion can still be cancelled; the actual data removal
 * happens later in purgeExpiredDeletedAccounts. Every session is dropped so no
 * device stays authenticated against a doomed account, and every credential is
 * dropped so reactivation must go through the e-mail "Recover account" flow
 * (which re-enrols a passkey and clears the mark) rather than a lingering
 * passkey login. The e-mail is returned so the caller can send the deletion
 * notice.
 *
 * @param env - function environment.
 * @param userId - the account requesting deletion.
 * @param now - current epoch timestamp, recorded as the deletion request time.
 * @returns the account's e-mail address, or null if the user row was not found.
 */
export async function requestAccountDeletion(
  env: Env,
  userId: string,
  now: number,
): Promise<string | null> {
  const results = await env.DB.batch<{ email: string }>([
    // RETURNING hands back the address in the same atomic batch, so no extra
    // read is needed to address the deletion notice.
    env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ? RETURNING email').bind(
      now,
      userId,
    ),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM credentials WHERE user_id = ?').bind(userId),
  ])
  return results[0]?.results[0]?.email ?? null
}

/**
 * Permanently removes every account whose deletion grace window has elapsed,
 * along with all of its data.
 *
 * Runs from the Worker's daily cron trigger. It used to piggyback on
 * email-request via waitUntil, which only stood in for a scheduled job while the
 * app ran on Pages. Child rows are deleted before the user rows so the doomed set
 * is still resolvable through deletion_requested_at, and the address-keyed
 * e-mail tables are cleared too, leaving nothing behind. The whole sweep is one
 * atomic batch, so a partial failure never leaves an account half-deleted.
 *
 * @param env - function environment.
 * @param now - current epoch timestamp; accounts requested before now minus the
 *   grace window are purged.
 */
export async function purgeExpiredDeletedAccounts(env: Env, now: number): Promise<void> {
  const cutoff = now - DELETION_GRACE_MS
  // The set of accounts past their grace window, resolved once per child table.
  // Kept as subqueries (rather than a client-side round trip) so the entire
  // purge is a single atomic batch.
  const doomedIds = 'SELECT id FROM users WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at <= ?'
  const doomedEmails = 'SELECT email FROM users WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at <= ?'
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM credentials WHERE user_id IN (${doomedIds})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (${doomedIds})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM notes WHERE user_id IN (${doomedIds})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM deleted_notes WHERE user_id IN (${doomedIds})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM email_codes WHERE email IN (${doomedEmails})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM email_code_rate_limits WHERE email IN (${doomedEmails})`).bind(cutoff),
    // The user rows last, so the subqueries above can still see them.
    env.DB.prepare(
      'DELETE FROM users WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at <= ?',
    ).bind(cutoff),
  ])
}
