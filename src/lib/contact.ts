import { apiFetch } from './api'

/**
 * Sends a contact-form message to the app owner. The server delivers it by
 * e-mail with the signed-in user's address as the Reply-To, so no address is
 * collected client-side.
 *
 * @param message - the plain-text message the user typed.
 * @throws ApiError on non-2xx responses (e.g. 401 when the session is invalid).
 */
export async function sendContactMessage(message: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/auth/contact', { message })
}
