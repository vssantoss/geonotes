import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setSystemBarsAppearance } from '../system-bars'

/**
 * The web-side contract of the system bar bridge: it must reach the native
 * plugin with the resolved appearance, stay out of the way on the web, and
 * never let a failure escape into the theme provider, which calls it on every
 * appearance change during render.
 */

const mocks = vi.hoisted(() => ({
  native: true,
  setAppearance: vi.fn((): Promise<void> => Promise.resolve()),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  registerPlugin: () => ({ setAppearance: mocks.setAppearance }),
}))

beforeEach(() => {
  mocks.native = true
  mocks.setAppearance.mockClear()
  mocks.setAppearance.mockImplementation(() => Promise.resolve())
})

describe('setSystemBarsAppearance', () => {
  it('passes the resolved appearance to the native plugin', () => {
    setSystemBarsAppearance(true)
    expect(mocks.setAppearance).toHaveBeenCalledWith({ dark: true })

    setSystemBarsAppearance(false)
    expect(mocks.setAppearance).toHaveBeenLastCalledWith({ dark: false })
  })

  it('does nothing on the web, where the browser owns its chrome', () => {
    mocks.native = false
    setSystemBarsAppearance(true)
    expect(mocks.setAppearance).not.toHaveBeenCalled()
  })

  it('swallows a missing or failing plugin', async () => {
    // An older native build has no SystemBars plugin registered, and the call
    // rejects. Cosmetics must not take the theme down with them.
    mocks.setAppearance.mockImplementation(() => Promise.reject(new Error('not implemented')))
    expect(() => setSystemBarsAppearance(true)).not.toThrow()
    await Promise.resolve()
  })
})
