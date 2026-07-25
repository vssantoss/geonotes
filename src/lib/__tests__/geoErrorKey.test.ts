import { beforeEach, describe, expect, it, vi } from 'vitest'

const isNativePlatform = vi.fn(() => false)

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}))

const { geoErrorKey } = await import('../geo')

beforeEach(() => {
  isNativePlatform.mockReturnValue(false)
})

describe('geoErrorKey', () => {
  it.each([
    ['timeout', 'gps.timeout'],
    ['unavailable', 'gps.unavailable'],
  ] as const)('maps %s to %s on every platform', (error, key) => {
    expect(geoErrorKey(error)).toBe(key)
    isNativePlatform.mockReturnValue(true)
    expect(geoErrorKey(error)).toBe(key)
  })

  it('points a refused web user at their browser settings', () => {
    expect(geoErrorKey('denied')).toBe('gps.denied')
  })

  it('points a refused app user at their device settings instead', () => {
    // The installed app has no browser settings to open, so the web wording
    // would send the user somewhere that does not exist.
    isNativePlatform.mockReturnValue(true)
    expect(geoErrorKey('denied')).toBe('gps.deniedApp')
  })
})
