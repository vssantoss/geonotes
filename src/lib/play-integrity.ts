import { Capacitor, registerPlugin } from '@capacitor/core'
import { sha256Hex } from './hash'

/**
 * The native PlayIntegrity plugin (implemented in
 * android/app/src/main/java/app/vshub/gnotes/PlayIntegrityPlugin.java and
 * registered in MainActivity). It wraps Google's Standard Integrity API: given
 * the linked Cloud project number and a request hash, it returns an integrity
 * token for the server to decode.
 */
interface PlayIntegrityPlugin {
  requestToken(options: { projectNumber: string; requestHash: string }): Promise<{ token: string }>
  warmUp(options: { projectNumber: string }): Promise<void>
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
 * Prepares the integrity token provider ahead of time, at app start.
 *
 * The Standard Integrity API splits into a slow prepare and a fast request:
 * measured on the dev emulator, preparing took 864ms and issuing a token from a
 * prepared provider took 9ms. Left to `getPlayIntegrityToken`, the prepare runs
 * lazily and its 864ms lands between the user tapping "send code" and the
 * request going out. Doing it at start moves it off that path. Preparing costs
 * no token quota, so the only cost is a background bind to the Play Store
 * service on app start.
 *
 * Fire and forget: it never throws, and `getPlayIntegrityToken` still prepares
 * on its own if this failed or never ran. No-op off native or with no project
 * number configured, exactly like the token request.
 *
 * @returns a promise that settles once the provider is warm, or immediately when
 *          there is nothing to warm up.
 */
export async function warmUpPlayIntegrity(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !PROJECT_NUMBER) return
  try {
    await PlayIntegrity.warmUp({ projectNumber: PROJECT_NUMBER })
  } catch {
    // Best effort. A failure here only means the first token request pays the
    // prepare it would have paid anyway.
  }
}

/**
 * Obtains a Play Integrity token for an e-mail request on native Android, in
 * place of the Turnstile widget the web build uses.
 *
 * The token is bound to the address by a request hash this module derives
 * itself, so the wire contract lives in one place: it must stay
 * `sha256(email.trim().toLowerCase())` hex, which is what the Worker re-derives
 * as `sha256Hex(normalizeEmail(email))` in api/auth/email-request.ts before
 * matching. Deriving it here rather than at the call site keeps it from being
 * accidentally satisfied by a local-only helper that is free to change.
 *
 * Returns null off native, or when no project number was configured at build
 * time, so callers need no platform check of their own. It never throws:
 * attestation is best-effort at this layer, and a null simply means the request
 * is sent without a token (the server then decides whether to allow it). A
 * native build with attestation configured server-side will be rejected if this
 * returns null, which is the intended fail-closed behaviour rather than a silent
 * bypass.
 *
 * @param email - the address the code is being requested for.
 * @returns the integrity token, or null when unavailable.
 */
export async function getPlayIntegrityToken(email: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform() || !PROJECT_NUMBER) return null
  try {
    const { token } = await PlayIntegrity.requestToken({
      projectNumber: PROJECT_NUMBER,
      requestHash: await sha256Hex(email.trim().toLowerCase()),
    })
    return token || null
  } catch {
    // Play Integrity can be unavailable (no Play Services, network, throttling).
    // Return null and let the server's decision stand rather than blocking the UI.
    return null
  }
}
