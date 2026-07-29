import { apiFetch } from './api'

// The e-mail-code flows that need no local state: proving control of a mailbox,
// and the one action that proof alone authorizes. Split out of auth.ts and
// account.ts because both of those reach into Dexie and the sync loop, and the
// standalone /delete-account page (src/delete-account.tsx) must not: it holds no
// session, owns no notes, and exists for people who have already uninstalled the
// app. Everything here is a plain call to the API and nothing more.
//
// Signing in still lives in auth.ts. A code alone never authenticates anyone:
// email-verify returns a short-lived enroll token, not a session.

/**
 * Requests a 6-digit confirmation code for an e-mail address, the first step of
 * account creation, account recovery and web account deletion. The server stores
 * only the code's hash and e-mails the code; it never signs anyone in on its own.
 *
 * In 'recover' mode the server only sends a code when an account already exists
 * for the address (responding identically eitherway), so recovery cannot create
 * an account and cannot reveal whether one exists.
 *
 * @param email - the address to send the code to.
 * @param mode - 'create' for a new account, 'recover' for an existing one.
 * @param turnstileToken - the Turnstile widget token, used on web when bot
 *          protection is configured; omitted (undefined) in dev, or on native
 *          where Play Integrity is used instead.
 * @param integrityToken - the Play Integrity token, used on native Android in
 *          place of Turnstile (the widget cannot run in the app's webview);
 *          omitted on web and when Play Integrity is unavailable.
 * @returns the dev-only echoed code when the server runs in dev mode and a code
 *          was actually sent, so the flow is testable without a real inbox;
 *          empty in production or when nothing was sent.
 * @throws ApiError(429) when a code was requested too recently.
 * @throws ApiError(403) when the required bot-resistance token is missing or
 *          rejected (Turnstile on web, Play Integrity on native).
 */
export async function requestEmailCode(
  email: string,
  mode: 'create' | 'recover',
  turnstileToken?: string | null,
  integrityToken?: string | null,
): Promise<{ devCode?: string }> {
  return apiFetch<{ sent: boolean; devCode?: string }>('/api/auth/email-request', {
    email,
    mode,
    turnstileToken: turnstileToken ?? undefined,
    integrityToken: integrityToken ?? undefined,
  })
}

/**
 * Confirms a code and obtains a short-lived enroll token proving the address is
 * owned. The token authorizes enrolling a passkey or deleting the account it
 * belongs to; it is not a session.
 *
 * @param email - the address the code was sent to.
 * @param code - the 6-digit code the user typed.
 * @returns the enroll token to pass to createAccountWithPasskey or
 *          deleteAccountByEmail.
 * @throws ApiError(401) when the code is wrong, expired or exhausted.
 */
export async function confirmEmailCode(email: string, code: string): Promise<string> {
  const out = await apiFetch<{ enrollToken: string }>('/api/auth/email-verify', { email, code })
  return out.enrollToken
}

/**
 * Requests deletion of the account owning a just-verified e-mail address,
 * without being signed in. Used by the public /delete-account page. The
 * server-side effect is identical to the in-app deleteAccount(): the 30-day
 * grace window starts, every device is signed out and every passkey is removed,
 * and signing back in before the window elapses cancels it.
 *
 * Unlike deleteAccount() this does NOT wipe local data, because the address being
 * deleted need not be the account signed in on this browser. A session for the
 * deleted account is revoked server-side, so the app wipes its own copy on its
 * next sync, the same path a remote sign-out already takes.
 *
 * @param enrollToken - the token returned by confirmEmailCode for the address.
 * @throws ApiError(401) when the enroll token is invalid or expired.
 */
export async function deleteAccountByEmail(enrollToken: string): Promise<void> {
  await apiFetch('/api/auth/delete-account-by-email', { enrollToken })
}
