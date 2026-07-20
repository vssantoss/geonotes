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

/** How long an abandoned account (no passkey, no notes) is kept before
    purgeAbandonedAccounts removes it. An account with no credential can never
    sign in, so it is dead weight the moment registration is left half-finished;
    the window only gives a returning user time to complete the "Recover account"
    flow, which re-attaches a passkey to the same row and takes it out of scope. */
export const ABANDONED_ACCOUNT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Marks an account for deletion, signs out every device and removes every
 * passkey.
 *
 * The user row is kept (only stamped with the request time) so the address stays
 * reserved and the deletion can still be cancelled; the actual data removal
 * happens later in purgeExpiredDeletedAccounts. Every session is revoked so no
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
    // Stamped as revoked rather than deleted, the same tombstone the explicit
    // session-revoke endpoints leave. A deleted row is indistinguishable from a
    // natural expiry, so the other devices would keep the doomed account's notes
    // on disk; a tombstone makes requireUser answer SESSION_REVOKED_REASON, which
    // is what drives the client to wipe its local copy. Deleting an account must
    // clear devices at least as thoroughly as signing one out remotely does.
    env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, userId),
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

/**
 * Permanently removes abandoned accounts: those with no passkey and no notes
 * that have been idle past ABANDONED_ACCOUNT_TTL_MS, along with any address-keyed
 * e-mail rows they left behind.
 *
 * These are the orphans left when someone verifies an e-mail, has the user row
 * created by passkey-register-options so the credential has an owner to attach
 * to, then walks away before finishing enrolment. With no credential the account
 * can never be signed into, so it just reserves an address forever. Idleness is
 * measured from the account's most recent login (the newest sessions.created_at)
 * and falls back to when the account itself was created when it has never had a
 * session, which is the normal case here since signing in requires a credential.
 *
 * Accounts already going through the deletion flow are left to
 * purgeExpiredDeletedAccounts (deletion_requested_at IS NULL below) so this sweep
 * never short-circuits that flow's grace window. The predicate is re-evaluated,
 * rather than cached, on the final user delete: the only rows whose sessions the
 * batch clears first are ones already past the cutoff, and a session is always
 * created after its user, so a cleared session can only make an already-doomed
 * account fall back to its (older) creation time, never rescue a live one.
 *
 * @param env - function environment.
 * @param now - current epoch timestamp; accounts idle since before now minus the
 *   TTL are purged.
 */
export async function purgeAbandonedAccounts(env: Env, now: number): Promise<void> {
  const cutoff = now - ABANDONED_ACCOUNT_TTL_MS
  // An account is abandoned when it is not mid-deletion, owns no passkey and no
  // note, and its last sign-in (or, lacking any session, its creation) predates
  // the cutoff. Written against the bare `users` name, not an alias, so the exact
  // same predicate drives both the doomed-set subqueries and the final delete.
  const predicate = `users.deletion_requested_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = users.id)
    AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.user_id = users.id)
    AND COALESCE(
      (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = users.id),
      users.created_at
    ) <= ?`
  const doomedIds = `SELECT id FROM users WHERE ${predicate}`
  const doomedEmails = `SELECT email FROM users WHERE ${predicate}`
  await env.DB.batch([
    // The filter guarantees no credentials or notes survive, so only the
    // session tombstones and the address-keyed e-mail rows need clearing before
    // the user rows go, mirroring purgeExpiredDeletedAccounts.
    env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (${doomedIds})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM deleted_notes WHERE user_id IN (${doomedIds})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM email_codes WHERE email IN (${doomedEmails})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM email_code_rate_limits WHERE email IN (${doomedEmails})`).bind(
      cutoff,
    ),
    // The user rows last, so the subqueries above can still see them.
    env.DB.prepare(`DELETE FROM users WHERE ${predicate}`).bind(cutoff),
  ])
}
