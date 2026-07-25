import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * The native PlayIntegrity plugin (implemented in
 * android/app/src/main/java/app/vshub/gnotes/PlayIntegrityPlugin.java and
 * registered in MainActivity). It wraps Google's Standard Integrity API: given
 * the linked Cloud project number and a request hash, it returns an integrity
 * token for the server to decode.
 */
interface PlayIntegrityPlugin {
  requestToken(options: { projectNumber: string; requestHash: string }): Promise<{ token: string }>
}

const PlayIntegrity = registerPlugin<PlayIntegrityPlugin>('PlayIntegrity')

/**
 * The Google Cloud project number linked to the Play app, needed to request a
 * standard integrity token. Injected at native build time by `build:native`
 * (VITE_PLAY_INTEGRITY_PROJECT_NUMBER); empty on web and when unset, in which
 * case attestation is skipped.
 */
const PROJECT_NUMBER =
  (import.meta.env.VITE_PLAY_INTEGRITY_PROJECT_NUMBER as string | undefined) ?? ''

/**
 * Obtains a Play Integrity token for an e-mail request on native Android, in
 * place of the Turnstile widget the web build uses. The token is bound to the
 * request via `requestHash` (sha256 of the e-mail), which the server re-derives
 * and matches so a token cannot be replayed against a different address.
 *
 * Returns null off native, or when no project number was configured at build
 * time. It never throws: attestation is best-effort at this layer, and a null
 * simply means the request is sent without a token (the server then decides
 * whether to allow it). A native build with attestation configured server-side
 * will be rejected if this returns null, which is the intended fail-closed
 * behaviour rather than a silent bypass.
 *
 * @param requestHash - hex sha256 of the normalized e-mail, binding the token to
 *          this request.
 * @returns the integrity token, or null when unavailable.
 */
export async function getPlayIntegrityToken(requestHash: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform() || !PROJECT_NUMBER) return null
  try {
    const { token } = await PlayIntegrity.requestToken({
      projectNumber: PROJECT_NUMBER,
      requestHash,
    })
    return token || null
  } catch {
    // Play Integrity can be unavailable (no Play Services, network, throttling).
    // Return null and let the server's decision stand rather than blocking the UI.
    return null
  }
}
