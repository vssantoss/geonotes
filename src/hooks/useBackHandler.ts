import { useEffect, useRef } from 'react'
import { registerBackHandler } from '../lib/back-handlers'

/**
 * Lets a screen answer the back press (Android's back button, the browser's
 * back) before the app shell navigates away from it.
 *
 * @param handler - called on back; returns true when it handled the press,
 *   false to let the shell leave the screen as usual.
 */
export function useBackHandler(handler: () => boolean): void {
  // Held in a ref so the handler always sees the current render's state
  // without re-registering, which would move it in the handler stack.
  const current = useRef(handler)
  useEffect(() => {
    current.current = handler
  })
  useEffect(() => registerBackHandler(() => current.current()), [])
}
