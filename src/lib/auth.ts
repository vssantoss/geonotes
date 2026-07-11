import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { apiFetch, setSessionToken } from './api'
import { db, KV, kvGet, kvSet } from './db'
import { syncNow } from './sync'

/**
 * Requests a 6-digit sign-in code to be e-mailed.
 *
 * @param email - the user's e-mail address.
 * @returns the dev-mode code echo when the server runs with ENVIRONMENT=dev,
 *          otherwise null (the code arrives by e-mail).
 */
export async function requestEmailCode(email: string): Promise<string | null> {
  const out = await apiFetch<{ sent: boolean; devCode?: string }>('/api/auth/email-request', {
    email,
  })
  return out.devCode ?? null
}

/**
 * Verifies an e-mailed code and establishes a session.
 *
 * @param email - the address the code was sent to.
 * @param code - the 6-digit code.
 * @throws ApiError(401) when the code is wrong or expired.
 */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const out = await apiFetch<{ token: string }>('/api/auth/email-verify', { email, code })
  await establishSession(out.token, email)
}

/**
 * Signs in with a passkey registered for this e-mail.
 *
 * @param email - the user's e-mail address.
 * @throws when no credential exists or the ceremony fails.
 */
export async function passkeyLogin(email: string): Promise<void> {
  const { options, challengeToken } = await apiFetch<{
    options: PublicKeyCredentialRequestOptionsJSON
    challengeToken: string
  }>('/api/auth/passkey-login-options', { email })
  const response = await startAuthentication({ optionsJSON: options })
  const out = await apiFetch<{ token: string }>('/api/auth/passkey-login', {
    email,
    response,
    challengeToken,
  })
  await establishSession(out.token, email)
}

/**
 * Registers a passkey on this device for the signed-in user.
 *
 * @throws when the browser refuses or the user cancels the ceremony.
 */
export async function registerPasskey(): Promise<void> {
  const { options, challengeToken } = await apiFetch<{
    options: PublicKeyCredentialCreationOptionsJSON
    challengeToken: string
  }>('/api/auth/passkey-register-options', {})
  const response = await startRegistration({ optionsJSON: options })
  await apiFetch('/api/auth/passkey-register', { response, challengeToken })
}

/**
 * Signs out: revokes the server session and wipes all local data (notes,
 * outbox, cursor), since the device may change hands. The app then returns
 * to its optional local-only mode with an empty device.
 */
export async function signOut(): Promise<void> {
  // Final flush so unsynced changes reach the account before the wipe below.
  // syncNow never throws; when offline it returns immediately and any notes
  // still pending are lost with the wipe, which the sign-out dialog warns about.
  await syncNow()
  // Best-effort revocation; local sign-out proceeds even when offline.
  await apiFetch('/api/auth/logout', {}).catch(() => {})
  await db.transaction('rw', db.notes, db.outbox, db.kv, async () => {
    await db.notes.clear()
    await db.outbox.clear()
    await db.kv.clear()
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
