import { startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { apiFetch } from './api'
import { db, KV, kvGet, kvSet } from './db'
import { hashAccount, requestEmailCode, confirmEmailCode } from './auth'

// Account management for an already signed-in user: passkeys, sessions and the
// account e-mail. The sign-in/sign-out flow lives in auth.ts; this module only
// deals with maintaining an existing account from the settings screen.

/** A passkey as shown in the settings list. */
export interface PasskeyInfo {
  /** The WebAuthn credential id, used to remove the passkey. */
  id: string
  /** Friendly name given when the passkey was added, or null. */
  label: string | null
  /** Epoch ms when the passkey was registered. */
  created_at: number
}

/** An active session as shown in the settings list. */
export interface SessionInfo {
  /** Public session id used to revoke it; null for pre-migration sessions. */
  id: string | null
  createdAt: number | null
  lastSeen: number | null
  /** Raw user agent, for deriving a device label; may be null. */
  userAgent: string | null
  expiresAt: number
  /** Whether this is the session making the request (this device). */
  current: boolean
}

/**
 * Lists the signed-in account's passkeys.
 *
 * @returns the account's passkeys, oldest first.
 */
export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const out = await apiFetch<{ credentials: PasskeyInfo[] }>('/api/auth/credentials')
  return out.credentials
}

/**
 * Adds a passkey to the signed-in account by running a registration ceremony
 * authorized purely by the current session (no e-mail code needed). The browser
 * refuses to enroll an authenticator already registered to the account.
 *
 * @param label - optional friendly name to store for the new passkey.
 * @throws when the browser refuses or the user cancels the ceremony, or ApiError
 *         on server rejection.
 */
export async function addPasskey(label?: string): Promise<void> {
  const { options, challengeToken } = await apiFetch<{
    options: PublicKeyCredentialCreationOptionsJSON
    challengeToken: string
  }>('/api/auth/credentials/register-options', {})
  const response = await startRegistration({ optionsJSON: options })
  await apiFetch<{ ok: boolean }>('/api/auth/credentials/register', {
    response,
    challengeToken,
    label,
  })
}

/**
 * Removes one of the account's passkeys.
 *
 * @param id - the credential id to remove.
 * @throws ApiError(409) when it is the account's last passkey.
 */
export async function removePasskey(id: string): Promise<void> {
  await apiFetch(`/api/auth/credentials/${encodeURIComponent(id)}`, undefined, 'DELETE')
}

/**
 * Lists the signed-in account's active sessions, most recently used first.
 *
 * @returns the account's sessions, with the current one flagged.
 */
export async function listSessions(): Promise<SessionInfo[]> {
  const out = await apiFetch<{ sessions: SessionInfo[] }>('/api/auth/sessions')
  return out.sessions
}

/**
 * Revokes a specific session, signing out that device on its next request.
 *
 * @param id - the public session id to revoke.
 */
export async function revokeSession(id: string): Promise<void> {
  await apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, undefined, 'DELETE')
}

/**
 * Signs out every other session, keeping this device signed in.
 */
export async function revokeOtherSessions(): Promise<void> {
  await apiFetch('/api/auth/sessions/revoke-others', {})
}

/**
 * Sends a confirmation code to a NEW e-mail address, the first step of changing
 * the account e-mail. Reuses the standard account e-mail-code flow, so the code
 * proves control of the new mailbox.
 *
 * @param newEmail - the address to move the account to.
 * @returns the dev-only echoed code in dev mode, so the flow is testable.
 */
export async function requestEmailChangeCode(newEmail: string): Promise<{ devCode?: string }> {
  return requestEmailCode(newEmail, 'create')
}

/**
 * Confirms the code sent to the new address and applies the e-mail change on the
 * server, then re-points the local account markers at the new address. The
 * account id and notes are unchanged; only the e-mail (and the local owner hash
 * derived from it) move, so pending outbox entries are re-tagged to the new hash
 * and no spurious account-switch is later detected.
 *
 * @param newEmail - the new address the code was sent to.
 * @param code - the 6-digit code the user typed.
 * @throws ApiError(401) when the code is wrong/expired, ApiError(409) when the
 *         address already belongs to another account.
 */
export async function confirmEmailChange(newEmail: string, code: string): Promise<void> {
  const enrollToken = await confirmEmailCode(newEmail, code)
  await apiFetch<{ ok: boolean; email: string }>('/api/auth/email-change', { enrollToken })

  // Move the local markers to the new address. The owner hash is derived from
  // the e-mail, so recompute it and re-tag any outbox entries owned by the old
  // hash so pending notes still upload under this same account.
  const oldHash = await kvGet(KV.notesOwnerHash)
  const newHash = await hashAccount(newEmail)
  await db.transaction('rw', db.outbox, db.kv, async () => {
    if (oldHash) {
      await db.outbox.toCollection().modify((entry) => {
        if (entry.owner === oldHash) entry.owner = newHash
      })
    }
    await kvSet(KV.userEmail, newEmail)
    await kvSet(KV.notesOwnerHash, newHash)
  })
}
