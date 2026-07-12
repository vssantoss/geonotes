import { useSyncExternalStore } from 'react'
import { getSyncSnapshot, subscribeSyncStatus, type SyncSnapshot } from '../lib/sync'

/**
 * Hook exposing the sync engine's live snapshot to the UI.
 *
 * @returns the current status plus `alerting`, true once a sync error has
 *          persisted long enough to warrant telling the user.
 */
export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribeSyncStatus, getSyncSnapshot)
}
