import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionStatus } from '@capacitor/geolocation'

const isNativePlatform = vi.fn(() => true)
const checkPermissions = vi.fn<() => Promise<PermissionStatus>>()
const requestPermissions = vi.fn<() => Promise<PermissionStatus>>()

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}))
vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: () => checkPermissions(),
    requestPermissions: () => requestPermissions(),
  },
}))

const { canWatch, checkLocationPermission, explanationFor, requestLocationPermission } =
  await import('../location-permission')

/** Builds a Capacitor status from the two aliases the plugin reports. */
function status(location: string, coarseLocation: string): PermissionStatus {
  return { location, coarseLocation } as PermissionStatus
}

beforeEach(() => {
  isNativePlatform.mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('checkLocationPermission on native', () => {
  it('is granted when the location alias is granted', async () => {
    checkPermissions.mockResolvedValue(status('granted', 'granted'))
    await expect(checkLocationPermission()).resolves.toBe('granted')
  })

  it.each(['prompt', 'prompt-with-rationale', 'denied'])(
    'reports coarse when the user chose Approximate, whatever fine says (%s)',
    async (location) => {
      // The `location` alias covers fine + coarse and Capacitor only calls it
      // granted when both are, so an Approximate choice looks like a refusal on
      // that alias alone. Only coarseLocation separates it from a real refusal,
      // and the difference matters: Android still feeds the WebView a fix, just
      // never one precise enough for a note.
      //
      // `denied` is in the list because Capacitor reports the fine permission
      // that way from the first Approximate grant onwards, derived from
      // shouldShowRequestPermissionRationale, which Android answers false for in
      // the upgrade case even while the upgrade is still on offer. Treating that
      // as a spent offer sent users to the settings on their first Approximate
      // choice, before the app had ever asked for the upgrade.
      checkPermissions.mockResolvedValue(status(location, 'granted'))
      await expect(checkLocationPermission()).resolves.toBe('coarse')
    },
  )

  it.each(['prompt', 'prompt-with-rationale'])('is askable for %s', async (state) => {
    checkPermissions.mockResolvedValue(status(state, state))
    await expect(checkLocationPermission()).resolves.toBe('askable')
  })

  it('is blocked once both aliases are denied', async () => {
    checkPermissions.mockResolvedValue(status('denied', 'denied'))
    await expect(checkLocationPermission()).resolves.toBe('blocked')
  })

  it('falls back to askable when the plugin throws, so a failed check cannot lock the user out', async () => {
    checkPermissions.mockRejectedValue(new Error('no plugin'))
    await expect(checkLocationPermission()).resolves.toBe('askable')
  })

  it('reports coarse when the prompt itself came back Approximate', async () => {
    requestPermissions.mockResolvedValue(status('prompt', 'granted'))
    await expect(requestLocationPermission()).resolves.toBe('coarse')
  })
})

describe('checkLocationPermission on web', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false)
  })

  it.each([
    ['granted', 'granted'],
    ['denied', 'blocked'],
    ['prompt', 'askable'],
  ])('maps the Permissions API state %s to %s', async (state, expected) => {
    vi.stubGlobal('navigator', { permissions: { query: () => Promise.resolve({ state }) } })
    await expect(checkLocationPermission()).resolves.toBe(expected)
  })

  it('reports browser when the engine rejects the query, as Safari does', async () => {
    vi.stubGlobal('navigator', {
      permissions: { query: () => Promise.reject(new TypeError('unsupported name')) },
    })
    await expect(checkLocationPermission()).resolves.toBe('browser')
  })

  it('reports browser when there is no Permissions API at all', async () => {
    vi.stubGlobal('navigator', {})
    await expect(checkLocationPermission()).resolves.toBe('browser')
  })
})

describe('explanationFor', () => {
  it('says nothing about states with nothing to explain', () => {
    expect(explanationFor(null, false)).toBeNull()
    expect(explanationFor('granted', false)).toBeNull()
    expect(explanationFor('browser', false)).toBeNull()
  })

  it('offers the precise-location upgrade until it has actually been asked for', () => {
    // Approximate is a grant, so nothing else tells the app the user is stuck
    // there. Android reveals whether the upgrade is still on offer only by
    // being asked, so the button is shown until that has been tried.
    expect(explanationFor('coarse', false)).toBe('coarse')
  })

  it('switches to the settings route once asking has changed nothing', () => {
    // Still `coarse` after an upgrade request means the prompt drew nothing
    // (USER_FIXED on the fine permission), so keeping the button would leave a
    // control that visibly does nothing.
    expect(explanationFor('coarse', true)).toBe('coarseBlocked')
  })

  it('passes the plain permission states straight through', () => {
    expect(explanationFor('askable', false)).toBe('askable')
    expect(explanationFor('blocked', false)).toBe('blocked')
  })
})

describe('canWatch', () => {
  it('allows a watch only where one can usefully start', () => {
    // `browser` is allowed because there the first geolocation call is itself
    // the request; `coarse` is not, because the fixes it yields can never reach
    // the accuracy a note needs.
    expect((['granted', 'browser'] as const).map(canWatch)).toEqual([true, true])
    expect((['coarse', 'askable', 'blocked'] as const).map(canWatch)).toEqual([false, false, false])
    expect(canWatch(null)).toBe(false)
  })
})
