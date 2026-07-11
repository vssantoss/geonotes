import { useSyncExternalStore } from 'react'

/**
 * Subscribes to browser connectivity events (for useSyncExternalStore).
 *
 * @param listener - called when connectivity changes.
 * @returns an unsubscribe function.
 */
function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/**
 * Hook reporting whether the browser currently has network connectivity.
 *
 * @returns true when online.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine)
}
