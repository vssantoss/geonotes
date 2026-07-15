import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { apiFetch } from './api'
import { db, KV, kvGet, kvSet } from './db'
import { syncNow } from './sync'

/**
 * A passkey ceremony the server has verified and placed in an HttpOnly cookie,
 * but that has not been linked to the local notes yet. Held so the caller can
 * confirm a risky account switch before finishSignIn applies the local marker.
 */
export interface PendingSignIn {
  email: string
}

/**
 * Thrown when the browser passkey ceremony itself does not produce a
 * credential: none exists for this site, or the user dismissed the prompt.
 * Distinguished from server/network failures so the UI only offers account
 * creation when the device really has no usable passkey.
 */
export class PasskeyUnavailableError extends Error {
  constructor(cause: unknown) {
    super('passkey ceremony failed', { cause })
  }
}

/**
 * Signs in with a passkey, usernameless: the browser offers any passkey it
 * holds for this site and the server identifies the account from it, so no
 * e-mail is typed. The server sets the protected cookie, while the caller waits
 * to apply the local account marker until account-switch confirmation passes.
 *
 * @returns the verified sign-in, including the account e-mail for the UI.
 * @throws PasskeyUnavailableError when no passkey is available or the ceremony
 *         is cancelled; ApiError when the server rejects the sign-in.
 */
export async function passkeyLogin(): Promise<PendingSignIn> {
  const { options, challengeToken } = await apiFetch<{
    options: PublicKeyCredentialRequestOptionsJSON
    challengeToken: string
  }>('/api/auth/passkey-login-options', {})
  let response: Awaited<ReturnType<typeof startAuthentication>>
  try {
    response = await startAuthentication({ optionsJSON: options })
  } catch (err) {
    throw new PasskeyUnavailableError(err)
  }
  const out = await apiFetch<{ email: string }>('/api/auth/passkey-login', {
    response,
    challengeToken,
  })
  return { email: out.email }
}

/**
 * Requests a 6-digit confirmation code for an e-mail address, the first step of
 * both account creation and recovery. The server stores only the code's hash
 * and e-mails the code; it never signs anyone in on its own.
 *
 * In 'recover' mode the server only sends a code when an account already exists
 * for the address (responding identically eitherway), so recovery cannot create
 * an account and cannot reveal whether one exists.
 *
 * @param email - the address to send the code to.
 * @param mode - 'create' for a new account, 'recover' for an existing one.
 * @returns the dev-only echoed code when the server runs in dev mode and a code
 *          was actually sent, so the flow is testable without a real inbox;
 *          empty in production or when nothing was sent.
 * @throws ApiError(429) when a code was requested too recently.
 */
export async function requestEmailCode(
  email: string,
  mode: 'create' | 'recover',
): Promise<{ devCode?: string }> {
  return apiFetch<{ sent: boolean; devCode?: string }>('/api/auth/email-request', { email, mode })
}

/**
 * Confirms a code and obtains a short-lived enroll token proving the address is
 * owned. The token authorizes enrolling a passkey; it is not a session.
 *
 * @param email - the address the code was sent to.
 * @param code - the 6-digit code the user typed.
 * @returns the enroll token to pass to createAccountWithPasskey.
 * @throws ApiError(401) when the code is wrong, expired or exhausted.
 */
export async function confirmEmailCode(email: string, code: string): Promise<string> {
  const out = await apiFetch<{ enrollToken: string }>('/api/auth/email-verify', { email, code })
  return out.enrollToken
}

/**
 * Enrolls a passkey for an address whose ownership was just confirmed. Serves
 * both account creation (no account yet) and recovery (adding a passkey to an
 * existing account); the server decides which from the enroll token. The
 * server sets the protected cookie and finishSignIn applies the local marker.
 *
 * @param email - the confirmed address (used for the account-switch check).
 * @param enrollToken - the token returned by confirmEmailCode.
 * @returns the verified sign-in for the account.
 * @throws ApiError(401) when the enroll token is invalid or expired, or when
 *         the browser refuses or the user cancels the ceremony.
 */
export async function createAccountWithPasskey(
  email: string,
  enrollToken: string,
): Promise<PendingSignIn> {
  const { options, challengeToken } = await apiFetch<{
    options: PublicKeyCredentialCreationOptionsJSON
    challengeToken: string
  }>('/api/auth/passkey-register-options', { enrollToken })
  const response = await startRegistration({ optionsJSON: options })
  await apiFetch<{ ok: boolean }>('/api/auth/passkey-register', {
    email,
    response,
    challengeToken,
  })
  return { email }
}

/**
 * Detects whether taking over this device for the given account would discard
 * notes belonging to a different account already on it. The first sync after
 * sign-in does a full pull that removes local notes the new account does not
 * have, so settled (already-synced) notes from the previous account would be
 * lost. Pending notes still waiting in the outbox are not at risk: they are
 * pushed to the new account instead.
 *
 * Works from the e-mail alone so both signing in and creating a new account can
 * warn before anything is applied (account creation checks this up front, before
 * registering the passkey, so cancelling leaves nothing behind).
 *
 * @param email - the account about to take over this device.
 * @returns true when the previous account's settled notes would be removed and
 *          the action should be confirmed; false when it is safe.
 */
export async function wouldDisplaceNotes(email: string): Promise<boolean> {
  const ownerHash = await kvGet(KV.notesOwnerHash)
  // No owner recorded, or the same account: nothing is being displaced.
  if (!ownerHash) return false
  if (ownerHash === (await hashAccount(email))) return false
  return hasSettledNotes()
}

/**
 * Applies a verified sign-in: stores the local account marker and syncs. Any settled notes
 * from a previous account are reconciled away by that first sync, so callers
 * that care should confirm with wouldDisplaceNotes beforehand.
 *
 * @param pending - the verified sign-in to establish.
 */
export async function finishSignIn(pending: PendingSignIn): Promise<void> {
  await establishSession(pending.email)
}

/**
 * Revokes a server session created by a passkey ceremony that was not applied.
 *
 * @returns a promise that settles after the best-effort revocation request.
 */
export async function cancelPendingSignIn(): Promise<void> {
  await apiFetch('/api/auth/logout', {}).catch(() => {})
}

/**
 * Reports whether the device holds at least one settled note: a note with no
 * pending outbox entry, i.e. one that belongs to a previously synced account
 * rather than a local-only draft.
 *
 * @returns true when a settled note exists.
 */
async function hasSettledNotes(): Promise<boolean> {
  if ((await db.notes.count()) === 0) return false
  const pendingIds = new Set((await db.outbox.toArray()).map((e) => e.noteId))
  const noteIds = await db.notes.toCollection().primaryKeys()
  return noteIds.some((id) => !pendingIds.has(id))
}

/**
 * Reports whether local changes are still waiting to reach the account, i.e.
 * the outbox is not empty. Used to warn at sign-out that not everything has
 * synced, so removing the notes from the device would lose them.
 *
 * @returns true when at least one note change is unsynced.
 */
export async function hasUnsyncedNotes(): Promise<boolean> {
  return (await db.outbox.count()) > 0
}

/**
 * Hashes an account e-mail into an opaque, non-reversible identifier, so the
 * device can recognise the same account again without storing the address.
 * The e-mail is lower-cased and trimmed first to match the server's
 * normalisation, so login and account creation hash to the same value.
 *
 * @param email - the account e-mail.
 * @returns a hex-encoded SHA-256 digest.
 */
async function hashAccount(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Signs out: revokes the server session and drops the account link so the app
 * returns to its optional local-only mode.
 *
 * @param keepNotes - true to leave the notes on this device for offline use;
 *   false to also wipe notes and the outbox (e.g. the device may change hands).
 */
export async function signOut(keepNotes: boolean): Promise<void> {
  // Final flush so unsynced changes reach the account before anything is
  // removed below. syncNow never throws; when offline it returns immediately
  // and, when not keeping notes, any still-pending changes are lost with the
  // wipe, which the sign-out dialog warns about.
  await syncNow()
  // Best-effort revocation; local sign-out proceeds even when offline.
  await apiFetch('/api/auth/logout', {}).catch(() => {})
  await db.transaction('rw', db.notes, db.outbox, db.kv, async () => {
    if (!keepNotes) {
      await db.notes.clear()
      await db.outbox.clear()
      // The device no longer holds any account's notes.
      await kvSet(KV.notesOwnerHash, null)
    }
    // Clear the account link either way. The sync cursor is account-scoped, so
    // it goes too; a later sign-in reconciles from scratch.
    await kvSet(KV.userEmail, null)
    await kvSet(KV.syncCursor, null)
  })
}

/**
 * Stores the session and immediately syncs so a returning user's notes are
 * downloaded for offline use.
 *
 * @param email - the authenticated address, kept for the passkey flow UI.
 */
async function establishSession(email: string): Promise<void> {
  const ownerHash = await hashAccount(email)
  await kvSet(KV.userEmail, email)
  // Record (as an opaque hash) who owns the notes now on this device so a later
  // sign-in with a different account can warn before the first sync discards
  // them, without leaving the previous account's e-mail on the device.
  await kvSet(KV.notesOwnerHash, ownerHash)
  // Claim local-only (ownerless) pending notes for this account: created before
  // any sign-in, they belong to whoever signs in first. Entries already tagged
  // to a different account are left untouched, so switching accounts on a device
  // never relabels and uploads another account's pending operations.
  await db.outbox.toCollection().modify((entry) => {
    if (entry.owner === null) entry.owner = ownerHash
  })
  void syncNow()
}
