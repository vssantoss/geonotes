import { describe, expect, it } from 'vitest'
import { distanceMeters, formatDistance, nearbyRadiusMeters, NEARBY_MIN_RADIUS_M } from '../geo'

describe('distanceMeters', () => {
  it('is zero for identical points', () => {
    expect(distanceMeters(40.0, -8.0, 40.0, -8.0)).toBe(0)
  })

  it('matches a known distance (1 degree of latitude ~ 111.19 km)', () => {
    const d = distanceMeters(40.0, -8.0, 41.0, -8.0)
    expect(d).toBeGreaterThan(111000)
    expect(d).toBeLessThan(111400)
  })

  it('handles short distances precisely (~11 m per 0.0001 deg lat)', () => {
    const d = distanceMeters(40.0, -8.0, 40.0001, -8.0)
    expect(d).toBeGreaterThan(10)
    expect(d).toBeLessThan(12)
  })
})

describe('nearbyRadiusMeters', () => {
  it('uses the minimum radius for precise fixes', () => {
    expect(nearbyRadiusMeters(5)).toBe(NEARBY_MIN_RADIUS_M)
  })

  it('grows with coarse fixes', () => {
    expect(nearbyRadiusMeters(40)).toBe(40)
  })
})

describe('formatDistance', () => {
  it('formats meters below 1 km for metric locales', () => {
    expect(formatDistance(12.4, 'pt')).toBe('12 m')
  })

  it('formats kilometers above 1 km for metric locales', () => {
    expect(formatDistance(3400, 'pt')).toBe('3.4 km')
  })

  it('formats feet below a mile for imperial locales', () => {
    // 3.05 m ~ 10 ft.
    expect(formatDistance(3.05, 'en')).toBe('10 ft')
    expect(formatDistance(3.05, 'es')).toBe('10 ft')
  })

  it('formats miles past a mile for imperial locales', () => {
    // 3218 m ~ 2.0 mi.
    expect(formatDistance(3218, 'en')).toBe('2.0 mi')
  })
})
