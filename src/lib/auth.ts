import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { apiFetch, setSessionToken } from './api'
import { db, KV, kvGet, kvSet } from './db'
import { syncNow } from './sync'

/**
 * Signs in with a passkey, usernameless: the browser offers any passkey it
 * holds for this site and the server identifies the account from it, so no
 * e-mail is typed. The account e-mail comes back from the server for the UI.
 *
 * @throws when no passkey is available or the ceremony is cancelled/fails.
 */
export async function passkeyLogin(): Promise<void> {
  const { options, challengeToken } = await apiFetch<{
    options: PublicKeyCredentialRequestOptionsJSON
    challengeToken: string
  }>('/api/auth/passkey-login-options', {})
  const response = await startAuthentication({ optionsJSON: options })
  const out = await apiFetch<{ token: string; email: string }>('/api/auth/passkey-login', {
    response,
    challengeToken,
  })
  await establishSession(out.token, out.email)
}

/**
 * Creates a new account: registers a passkey against the given e-mail and
 * signs the user in. The e-mail is stored for future account recovery.
 *
 * @param email - the address to attach to the new account.
 * @throws ApiError(409) when an account with that e-mail already exists, or
 *         when the browser refuses or the user cancels the ceremony.
 */
export async function createAccountWithPasskey(email: string): Promise<void> {
  const { options, challengeToken } = await apiFetch<{
    options: PublicKeyCredentialCreationOptionsJSON
    challengeToken: string
  }>('/api/auth/passkey-register-options', { email })
  const response = await startRegistration({ optionsJSON: options })
  const out = await apiFetch<{ token: string }>('/api/auth/passkey-register', {
    email,
    response,
    challengeToken,
  })
  await establishSession(out.token, email)
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
    }
    // Clear the account link either way: without a session token the app is in
    // local-only mode. The sync cursor is account-scoped, so it goes too; a
    // later sign-in reconciles from scratch.
    await kvSet(KV.sessionToken, null)
    await kvSet(KV.userEmail, null)
    await kvSet(KV.syncCursor, null)
  })
}

/**
 * Stores the session and immediately syncs so a returning user's notes are
 * downloaded for offline use.
 *
 * @param token - the bearer token issued by the server.
 * @param email - the authenticated address, kept for the passkey flow UI.
 */
async function establishSession(token: string, email: string): Promise<void> {
  await setSessionToken(token)
  await kvSet(KV.userEmail, email)
  void syncNow()
}

/**
 * Reads the stored session token, if any.
 *
 * @returns the token or null when signed out.
 */
export async function getSessionToken(): Promise<string | null> {
  return kvGet(KV.sessionToken)
}
