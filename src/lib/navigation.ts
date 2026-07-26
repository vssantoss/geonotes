// The app's screen stack, modelled over the browser's history so one back
// press means the same thing everywhere: the browser's back button, the
// Android hardware back button and the app's own Cancel/Done buttons all pop
// the same stack.
//
// This is deliberately not a router. The app lives at a single URL (the
// Worker serves one document, the native build loads one file) and never puts
// a screen in the address bar; all it needs to know is which screen is showing
// and what pressing back should reveal.

/** The app's screens. 'main' is the root: it is always the bottom of the stack. */
export type Route = 'main' | 'editor' | 'auth' | 'settings'

/** Every stack starts here, and back from here leaves the app. */
export const ROOT_ROUTE: Route = 'main'

/** All routes, for validating a history entry written by an older build. */
const ROUTES: readonly Route[] = ['main', 'editor', 'auth', 'settings']

/** The history operation a navigation needs. */
export type NavPlan = { kind: 'stay' } | { kind: 'push' } | { kind: 'back'; steps: number }

/** A planned navigation: what to do to the history, and the stack it leaves. */
export interface PlannedNavigation {
  plan: NavPlan
  stack: Route[]
}

/**
 * Plans a move to a route.
 *
 * A route already on the stack is returned to by going *back* to it rather
 * than by pushing it a second time. That is what keeps main -> settings ->
 * main -> settings from piling up: the stack only ever holds the screens that
 * are genuinely open, each once, so pressing back walks out of the app instead
 * of replaying the path that led here.
 *
 * @param stack - the current stack, root first, current screen last.
 * @param target - the route being opened.
 * @returns the history operation to perform and the resulting stack.
 */
export function planNavigation(stack: readonly Route[], target: Route): PlannedNavigation {
  const depth = stack.indexOf(target)
  if (depth === stack.length - 1) return { plan: { kind: 'stay' }, stack: [...stack] }
  if (depth >= 0) {
    return {
      plan: { kind: 'back', steps: stack.length - 1 - depth },
      stack: stack.slice(0, depth + 1),
    }
  }
  return { plan: { kind: 'push' }, stack: [...stack, target] }
}

/** What the app stores on each history entry it creates. */
export interface NavEntry {
  /** Identifies the entries created by this page load (see readNavEntry). */
  session: string
  /** The screen the entry shows. */
  route: Route
}

/**
 * Builds the state for the history entry of the stack's current screen.
 *
 * @param session - the current page load's session id.
 * @param stack - the stack whose top the entry represents.
 * @returns the state to hand to pushState/replaceState.
 */
export function navEntry(session: string, stack: readonly Route[]): NavEntry {
  return { session, route: stack[stack.length - 1] }
}

/**
 * Reads back the state of a history entry the browser has moved to.
 *
 * Entries that are not this page load's are rejected. A reload keeps the
 * browser's entries but resets the app, which re-seeds its stack on the entry
 * it was reloaded on, so an older entry describes a stack that no longer
 * exists; anything else on the origin (another page's entry) never described
 * one at all. The caller falls back to the root for both.
 *
 * @param state - the popped entry's history state.
 * @param session - the current page load's session id.
 * @returns the entry, or null when it is not one of this page load's.
 */
export function readNavEntry(state: unknown, session: string): NavEntry | null {
  if (typeof state !== 'object' || state === null) return null
  const { session: entrySession, route } = state as Partial<NavEntry>
  if (entrySession !== session) return null
  if (typeof route !== 'string' || !ROUTES.includes(route)) return null
  return { session, route }
}

/**
 * Resolves the stack after the browser moved back to one of the app's entries.
 *
 * @param stack - the stack before the move.
 * @param route - the route recorded on the entry moved to.
 * @returns the stack truncated to that route, or a minimal stack rebuilt
 *   around it when the entry is not on the current stack.
 */
export function applyEntry(stack: readonly Route[], route: Route): Route[] {
  const depth = stack.indexOf(route)
  if (depth >= 0) return stack.slice(0, depth + 1)
  return route === ROOT_ROUTE ? [ROOT_ROUTE] : [ROOT_ROUTE, route]
}
