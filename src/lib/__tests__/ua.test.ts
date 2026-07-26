import { describe, expect, it } from 'vitest'
import { deviceLabel } from '../ua'

/**
 * The user-agent prettifier behind both settings lists.
 *
 * The cases worth pinning down are the Android WebView, which shares an engine
 * with Chrome and carries the same `Chrome/` token, and the device model, which
 * sits in a section of the agent that browsers have been progressively
 * emptying. The rest are ordering guards, since several markers appear in every
 * modern agent at once.
 */

/** The app after appendUserAgent, on a real device. */
const APP_PIXEL =
  'Mozilla/5.0 (Linux; Android 16; Pixel 10 Build/AP4A.250105.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.124 Mobile Safari/537.36 GeoNotesApp'

/** The app as recorded before appendUserAgent existed, on the emulator. */
const APP_LEGACY =
  'Mozilla/5.0 (Linux; Android 15; sdk_gphone16k_x86_64 Build/AE3A.240806.041; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.124 Mobile Safari/537.36'

/** Chrome on Android, whose reduced agent names no model. */
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.124 Mobile Safari/537.36'

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'

describe('deviceLabel', () => {
  it('names the app and its device rather than the engine it runs on', () => {
    expect(deviceLabel(APP_PIXEL)).toBe('GeoNotes on Pixel 10')
  })

  it('still recognises the app in agents recorded before the token existed', () => {
    expect(deviceLabel(APP_LEGACY)).toBe('GeoNotes on sdk_gphone16k_x86_64')
  })

  it('falls back to the OS when the browser reduced the model away', () => {
    // Chrome sends a literal "K" in place of the model, which names no device.
    expect(deviceLabel(ANDROID_CHROME)).toBe('Chrome on Android')
  })

  it('reads the model with no build id attached', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-S911B) Chrome/141.0 Mobile Safari/537.36')).toBe(
      'Chrome on SM-S911B',
    )
  })

  it('does not mistake a desktop agent for the app', () => {
    expect(deviceLabel(WINDOWS_CHROME)).toBe('Chrome on Windows')
  })

  it('prefers the branded browser over the engine tokens it carries', () => {
    expect(deviceLabel(`${WINDOWS_CHROME} Edg/141.0`)).toBe('Edge on Windows')
  })

  it('falls back to whichever half it recognises', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows')
    expect(deviceLabel('Firefox/1.0')).toBe('Firefox')
  })

  it('returns null for a missing or unrecognised agent', () => {
    expect(deviceLabel(null)).toBeNull()
    expect(deviceLabel('curl/8.5.0')).toBeNull()
  })
})
