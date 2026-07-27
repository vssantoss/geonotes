import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { runBackHandlers } from '../lib/back-handlers'
import { closeTopOverlay } from '../lib/overlays'
import {
  applyEntry,
  navEntry,
  planNavigation,
  readNavEntry,
  ROOT_ROUTE,
  type Route,
} from '../lib/navigation'

/**
 * Identifies the history entries this page load created. A reload keeps the
 * browser's entries but starts the app over, so an entry carrying an older
 * session describes a stack that no longer exists (see readNavEntry).
 */
const SESSION = Math.random().toString(36).slice(2)

/** What the app shell needs to move between screens. */
export interface Navigation {
  /** The screen currently showing. */
  route: Route
  /** Opens a screen, or returns to it when it is already open below. */
  go: (route: Route) => void
}

/**
 * Drives the app's screens from the history stack, so back works everywhere.
 *
 * On the web the browser's back button (and the phone gesture) pops the stack
 * through popstate. On Android the hardware back button reaches the app
 * through Capacitor instead, and is answered the same way, except at the root:
 * the browser leaves the site, the app exits. In both cases an open overlay or
 * a screen with its own steps gets the press first.
 *
 * @param initial - the stack the app starts on, root first; deeper than one
 *   entry when the app opens straight onto a screen (a restored draft).
 * @returns the current route and the function to change it.
 */
export function useNavigation(initial: readonly Route[]): Navigation {
  const stackRef = useRef<Route[]>([...initial])
  const [route, setRoute] = useState<Route>(initial[initial.length - 1])
  // Pops the app asked for itself. They must not be mistaken for the user
  // pressing back, which an overlay or a screen may want to claim instead.
  const selfPops = useRef(0)
  // Guards the seeding below against StrictMode's double mount, which would
  // otherwise push the initial entries twice.
  const seeded = useRef(false)

  /** Records a stack as current and shows its top screen. */
  const apply = useCallback((stack: Route[]) => {
    stackRef.current = stack
    setRoute(stack[stack.length - 1])
  }, [])

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    // The entry the app loaded on becomes its root, then any screen the app
    // opens on gets an entry of its own, so back from it reaches the root
    // rather than leaving.
    const stack = stackRef.current
    window.history.replaceState(navEntry(SESSION, stack.slice(0, 1)), '')
    for (let depth = 1; depth < stack.length; depth++) {
      window.history.pushState(navEntry(SESSION, stack.slice(0, depth + 1)), '')
    }
  }, [])

  /**
   * Pops entries off the history. The screen changes immediately rather than
   * on the popstate that follows, so a second press (a double-tapped Cancel)
   * sees the stack it is about to leave, not the one it already left.
   *
   * @param steps - how many entries to pop.
   * @param stack - the stack that remains.
   */
  const pop = useCallback(
    (steps: number, stack: Route[]) => {
      apply(stack)
      selfPops.current += 1
      window.history.go(-steps)
    },
    [apply],
  )

  const go = useCallback(
    (target: Route) => {
      const { plan, stack } = planNavigation(stackRef.current, target)
      if (plan.kind === 'stay') return
      if (plan.kind === 'back') {
        pop(plan.steps, stack)
        return
      }
      apply(stack)
      window.history.pushState(navEntry(SESSION, stack), '')
    },
    [apply, pop],
  )

  /**
   * Leaves the current screen.
   *
   * @returns false at the root, where there is nothing left to pop and the
   *   platform decides what leaving means.
   */
  const back = useCallback(() => {
    const stack = stackRef.current
    if (stack.length <= 1) return false
    pop(1, stack.slice(0, -1))
    return true
  }, [pop])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      // A press the app made itself has already been answered, and its screen
      // change is already applied; the entry below only confirms it.
      if (selfPops.current > 0) {
        selfPops.current -= 1
      } else if (closeTopOverlay() || runBackHandlers()) {
        // Something on screen claimed the press, so the move the browser has
        // already made is undone by pushing the entry it came from again.
        window.history.pushState(navEntry(SESSION, stackRef.current), '')
        return
      }
      const entry = readNavEntry(event.state, SESSION)
      apply(applyEntry(stackRef.current, entry?.route ?? ROOT_ROUTE))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [apply])

  useEffect(() => {
    // The browser raises back as popstate above. Android's hardware button
    // reaches the webview only through Capacitor, and registering for it takes
    // over the button completely: with no listener the plugin swallows the
    // press, and without the plugin the activity finishes and the app exits.
    if (!Capacitor.isNativePlatform()) return
    const listener = CapacitorApp.addListener('backButton', () => {
      if (closeTopOverlay() || runBackHandlers()) return
      // At the root, back is the way out of an Android app, so honour it.
      if (!back()) void CapacitorApp.exitApp()
    })
    return () => {
      void listener.then((handle) => handle.remove())
    }
  }, [back])

  return { route, go }
}
