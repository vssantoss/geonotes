import { Capacitor } from '@capacitor/core'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'

// Key under which the session bearer token is held in the platform secure store
// (Android EncryptedSharedPreferences / Keystore, iOS Keychain).
const TOKEN_KEY = 'geonotes_session_token'

/**
 * The native session-token store.
 *
 * The web build authenticates with the HttpOnly `__Host-geonotes_session`
 * cookie, which JavaScript cannot read, so there is nothing for it to store:
 * every function here is a no-op off native. Only the Capacitor build, whose
 * webview is cross-origin to the API and cannot send that cookie, keeps the raw
 * token here and sends it as an Authorization bearer (see `apiFetch`).
 */

/**
 * The token as this module last saw it, so the secure store is read once per app
 * start rather than once per API call. `apiFetch` asks for the token on every
 * request, and on native each read is a Capacitor bridge round trip plus a
 * Keystore decrypt (and, when signed out, a rejected call the plugin throws
 * from). This module is the token's only writer, so the cache cannot go stale:
 * `undefined` means "not read yet", null means "known to be absent".
 */
let cachedToken: string | null | undefined

/**
 * Reads the stored native session token.
 *
 * @returns the token, or null on web or when none is stored.
 */
export async function getSessionToken(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  if (cachedToken !== undefined) return cachedToken
  try {
    const { value } = await SecureStoragePlugin.get({ key: TOKEN_KEY })
    cachedToken = value
  } catch {
    // The plugin rejects rather than returning null when the key is absent,
    // which is the normal signed-out state, so treat any read failure as "no
    // token" rather than surfacing it.
    cachedToken = null
  }
  return cachedToken
}

/**
 * Persists the native session token issued by a login endpoint. Does nothing on
 * web, or when the server returned no token (a web response body carries none).
 *
 * @param token - the raw session token, or undefined when absent.
 */
export async function setSessionToken(token: string | undefined): Promise<void> {
  if (!Capacitor.isNativePlatform() || !token) return
  await SecureStoragePlugin.set({ key: TOKEN_KEY, value: token })
  cachedToken = token
}

/**
 * Removes the stored native session token at sign-out. No-op on web or when no
 * token is stored.
 */
export async function clearSessionToken(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  // Set before the removal so a failure below cannot leave the cache serving a
  // token the caller has already decided is dead.
  cachedToken = null
  try {
    await SecureStoragePlugin.remove({ key: TOKEN_KEY })
  } catch {
    // Already absent: nothing to remove, and sign-out must not fail over it.
  }
}
