import { describe, expect, it, vi } from 'vitest'
import { registerBackHandler, runBackHandlers } from '../back-handlers'

/**
 * The order matters: the innermost screen is the one the user is looking at,
 * so it answers back first, and a screen that declines must not stop the one
 * below it (or the app shell) from answering.
 */
describe('back handlers', () => {
  it('reports nothing handled when none are registered', () => {
    expect(runBackHandlers()).toBe(false)
  })

  it('offers the press to the innermost handler first', () => {
    const outer = vi.fn(() => true)
    const inner = vi.fn(() => true)
    const removeOuter = registerBackHandler(outer)
    const removeInner = registerBackHandler(inner)

    expect(runBackHandlers()).toBe(true)
    expect(inner).toHaveBeenCalled()
    expect(outer).not.toHaveBeenCalled()

    removeInner()
    removeOuter()
  })

  it('falls through to the next handler when one declines', () => {
    const outer = vi.fn(() => true)
    const inner = vi.fn(() => false)
    const removeOuter = registerBackHandler(outer)
    const removeInner = registerBackHandler(inner)

    expect(runBackHandlers()).toBe(true)
    expect(inner).toHaveBeenCalled()
    expect(outer).toHaveBeenCalled()

    removeInner()
    removeOuter()
  })

  it('leaves the press to the caller when every handler declines', () => {
    const remove = registerBackHandler(() => false)
    expect(runBackHandlers()).toBe(false)
    remove()
  })

  it('stops offering the press to an unregistered handler', () => {
    const handler = vi.fn(() => true)
    registerBackHandler(handler)()
    expect(runBackHandlers()).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })
})
