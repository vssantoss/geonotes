import { describe, expect, it } from 'vitest'
import { deviceLabel } from '../ua'

/**
 * The user-agent prettifier behind both settings lists.
 *
 * The case worth pinning down is the Android WebView: it shares an engine with
 * Chrome and carries the same `Chrome/` token, so the naive match labelled the
 * app's own webview as a browser. The rest are ordering guards, since several
 * markers appear in every modern agent at once.
 */

const ANDROID_APP =
  'Mozilla/5.0 (Linux; Android 15; sdk_gphone16k_x86_64 Build/AE3A.240806.041; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.124 Mobile Safari/537.36'

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.124 Mobile Safari/537.36'

describe('deviceLabel', () => {
  it('names the app rather than its WebView engine', () => {
    expect(deviceLabel(ANDROID_APP)).toBe('GeoNotes for Android')
  })

  it('still calls the real Android browser Chrome', () => {
    expect(deviceLabel(ANDROID_CHROME)).toBe('Chrome on Android')
  })

  it('does not mistake a desktop agent for the app', () => {
    // "wv" only counts as the WebView token in the platform section of an
    // Android agent, so the substring appearing elsewhere must not match.
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      ),
    ).toBe('Chrome on Windows')
  })

  it('prefers the branded browser over the engine tokens it carries', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0',
      ),
    ).toBe('Edge on Windows')
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
