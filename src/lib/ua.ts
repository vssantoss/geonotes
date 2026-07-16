// Best-effort user-agent prettifier for the settings sessions list. This is
// display-only labelling, never used for any security decision, so a rough
// "Browser on OS" string is enough and unknown agents fall back gracefully.

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
 * Derives a short "Browser on OS" label from a user-agent string.
 *
 * @param userAgent - the raw user-agent, or null.
 * @returns e.g. "Chrome on Windows", a partial match, or null when nothing is
 *          recognised (the caller shows a generic "unknown device" label).
 */
export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1]
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1]
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system ?? null
}
