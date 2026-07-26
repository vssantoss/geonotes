// Screens that answer the back press themselves.
//
// A screen with steps of its own (the sign-in flow) has to see back before the
// app shell does, or pressing back halfway through would leave the flow
// altogether instead of stepping back through it. Handlers are consulted
// innermost-first, and one that declines lets the shell navigate as usual.

/** Returns true when the handler took the back press. */
type BackHandler = () => boolean

/** Registered handlers, outermost first (registration order = mount order). */
const handlers: BackHandler[] = []

/**
 * Registers a handler for the back press.
 *
 * @param handler - called on back; returns true when it handled the press.
 * @returns a function that unregisters it.
 */
export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const at = handlers.lastIndexOf(handler)
    if (at >= 0) handlers.splice(at, 1)
  }
}

/**
 * Offers a back press to the registered handlers, innermost first.
 *
 * @returns true when one of them handled it, so the app must not navigate.
 */
export function runBackHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true
  }
  return false
}
