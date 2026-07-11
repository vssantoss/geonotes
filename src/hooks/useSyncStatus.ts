import { useSyncExternalStore } from 'react'
import { getSyncStatus, subscribeSyncStatus, type SyncStatus } from '../lib/sync'

/**
 * Hook exposing the sync engine's live status to the UI.
 *
 * @returns 'idle' | 'syncing' | 'error' | 'unauthorized'.
 */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
}
