import { describe, expect, it } from 'vitest'
import {
  applyEntry,
  navEntry,
  planNavigation,
  readNavEntry,
  type Route,
} from '../navigation'

/**
 * The navigation model behind every back press. What matters here is that the
 * stack only ever holds the screens that are actually open: a screen reached
 * again is returned to, never stacked a second time, so back always walks
 * straight out instead of replaying the path that led there.
 */

describe('planNavigation', () => {
  it('pushes a screen opened from the main screen', () => {
    expect(planNavigation(['main'], 'settings')).toEqual({
      plan: { kind: 'push' },
      stack: ['main', 'settings'],
    })
  })

  it('does nothing when the screen is already showing', () => {
    expect(planNavigation(['main', 'editor'], 'editor')).toEqual({
      plan: { kind: 'stay' },
      stack: ['main', 'editor'],
    })
  })

  it('goes back to the main screen instead of pushing it again', () => {
    expect(planNavigation(['main', 'settings'], 'main')).toEqual({
      plan: { kind: 'back', steps: 1 },
      stack: ['main'],
    })
  })

  it('unwinds every screen above the target in one step', () => {
    expect(planNavigation(['main', 'settings', 'auth'], 'main')).toEqual({
      plan: { kind: 'back', steps: 2 },
      stack: ['main'],
    })
  })

  it('returns to a screen still open below rather than stacking it', () => {
    expect(planNavigation(['main', 'settings', 'auth'], 'settings')).toEqual({
      plan: { kind: 'back', steps: 1 },
      stack: ['main', 'settings'],
    })
  })

  it('never grows the stack when a screen is opened, left and opened again', () => {
    let stack: Route[] = ['main']
    for (let round = 0; round < 3; round++) {
      stack = planNavigation(stack, 'settings').stack
      expect(stack).toEqual(['main', 'settings'])
      stack = planNavigation(stack, 'main').stack
      expect(stack).toEqual(['main'])
    }
  })
})

describe('history entries', () => {
  it('records the stack\'s current screen', () => {
    expect(navEntry('s1', ['main', 'auth'])).toEqual({ session: 's1', route: 'auth' })
  })

  it('reads back an entry from this page load', () => {
    expect(readNavEntry(navEntry('s1', ['main', 'auth']), 's1')).toEqual({
      session: 's1',
      route: 'auth',
    })
  })

  it('rejects an entry left behind by an earlier page load', () => {
    expect(readNavEntry(navEntry('s1', ['main', 'auth']), 's2')).toBeNull()
  })

  it('rejects entries that are not the app\'s', () => {
    expect(readNavEntry(null, 's1')).toBeNull()
    expect(readNavEntry('back', 's1')).toBeNull()
    expect(readNavEntry({ session: 's1' }, 's1')).toBeNull()
    expect(readNavEntry({ session: 's1', route: 'nowhere' }, 's1')).toBeNull()
  })
})

describe('applyEntry', () => {
  it('truncates the stack to the screen moved back to', () => {
    expect(applyEntry(['main', 'settings', 'auth'], 'settings')).toEqual(['main', 'settings'])
    expect(applyEntry(['main', 'settings'], 'main')).toEqual(['main'])
  })

  it('rebuilds a stack around an entry it does not hold', () => {
    // Possible after a reload, which starts the app over on whichever entry
    // the browser restored.
    expect(applyEntry(['main'], 'settings')).toEqual(['main', 'settings'])
    expect(applyEntry(['main', 'editor'], 'main')).toEqual(['main'])
  })
})
