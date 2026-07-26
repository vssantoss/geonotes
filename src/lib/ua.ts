// Best-effort user-agent prettifier for the settings sessions and passkey
// lists. This is display-only labelling, never used for any security decision,
// so a rough "Client on Device" string is enough and unknown agents fall back
// gracefully.

/** The app's own name, shown in place of the browser it is built on. */
const APP_NAME = 'GeoNotes'

/**
 * The token Capacitor appends to the WebView user agent (see
 * `appendUserAgent` in capacitor.config.ts). This is the definitive signal
 * that a request came from the app rather than a browser.
 */
const APP_TOKEN = /\bGeoNotesApp\b/

/**
 * The generic Android WebView marker, used only as a fallback for agents
 * recorded before APP_TOKEN existed. Every Android app embedding a browser
 * carries it, so it says "some app" rather than "this app".
 */
const ANDROID_WEBVIEW = /;\s*wv\)/

/** Browser name markers, checked in order (Edge/Opera before Chrome/Safari). */
const BROWSERS: [RegExp, string][] = [
  [/Edg/i, 'Edge'],
  [/OPR|Opera/i, 'Opera'],
  [/Firefox|FxiOS/i, 'Firefox'],
  [/Chrome|CriOS/i, 'Chrome'],
  [/Safari/i, 'Safari'],
]

/** Operating-system markers, checked in order. */
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/Android/i, 'Android'],
  [/Windows/i, 'Windows'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/Linux/i, 'Linux'],
]

/**
 * Android puts Build.MODEL in the platform section, after the version:
 * "(Linux; Android 15; Pixel 10 Build/AP4A.250105.002; wv)". The build id is
 * optional and the section ends at the next semicolon or the closing bracket.
 */
const ANDROID_MODEL = /\bAndroid\s+[\d.]+;\s*([^;)]+)/

/**
 * Chrome's reduced Android agent replaces the model with this placeholder, so
 * it names no device and must not be shown as one.
 */
const REDUCED_MODEL = 'K'

/**
 * Extracts the Android device model from a user agent.
 *
 * @param userAgent - the raw user-agent.
 * @returns e.g. "Pixel 10", or null on a non-Android agent or one whose model
 *          the browser has reduced away.
 */
function androidModel(userAgent: string): string | null {
  const model = ANDROID_MODEL.exec(userAgent)?.[1]?.replace(/\s+Build\/.*$/, '').trim()
  if (!model || model === REDUCED_MODEL) return null
  return model
}

/**
 * Names what made the request: the app itself, or the browser it ran in.
 *
 * @param userAgent - the raw user-agent.
 * @param system - the already-matched OS name, or undefined.
 * @returns e.g. "GeoNotes" or "Chrome", or undefined when unrecognised.
 */
function clientName(userAgent: string, system: string | undefined): string | undefined {
  // Checked before browser matching, which would otherwise call the app's own
  // WebView "Chrome": the two share an engine and the same Chrome/ token.
  if (APP_TOKEN.test(userAgent)) return APP_NAME
  if (system === 'Android' && ANDROID_WEBVIEW.test(userAgent)) return APP_NAME
  return BROWSERS.find(([re]) => re.test(userAgent))?.[1]
}

/**
 * Derives a short "Client on Device" label from a user-agent string.
 *
 * @param userAgent - the raw user-agent, or null.
 * @returns e.g. "GeoNotes on Pixel 10" or "Chrome on Windows", a partial match
 *          when only one half is known, or null when nothing is recognised
 *          (the caller shows a generic "unknown device" label).
 */
export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1]
  const client = clientName(userAgent, system)
  // The model is the more useful of the two, and already implies the OS.
  const device = androidModel(userAgent) ?? system
  if (client && device) return `${client} on ${device}`
  return client ?? device ?? null
}
