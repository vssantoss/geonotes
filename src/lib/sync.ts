import { db, KV, kvGet, kvSet } from './db'
import { ApiError, apiFetch, reverseGeocode } from './api'
import type { Note, SyncOp, SyncRequest, SyncResponse } from '../../shared/types'

/** Sync engine state exposed to the UI. */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'unauthorized'

let status: SyncStatus = 'idle'
const listeners = new Set<() => void>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let runAgain = false

/**
 * Subscribes to sync status changes (for React's useSyncExternalStore).
 *
 * @param listener - called whenever the status changes.
 * @returns an unsubscribe function.
 */
export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Returns the current sync status (for React's useSyncExternalStore).
 */
export function getSyncStatus(): SyncStatus {
  return status
}

/**
 * Updates the status and notifies subscribers.
 *
 * @param next - the new status.
 */
function setStatus(next: SyncStatus): void {
  status = next
  for (const l of listeners) l()
}

/**
 * Requests a sync soon. Debounced so a burst of edits produces a single
 * request (each request costs D1 transactions on the free tier).
 */
export function scheduleSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void syncNow(), 2000)
}

/**
 * Runs a full sync cycle now: backfills missing addresses, pushes the outbox
 * and pulls server changes since the stored cursor, all in one API request.
 * Safe to call repeatedly; concurrent calls coalesce into one extra run.
 */
export async function syncNow(): Promise<void> {
  if (!navigator.onLine) return
  if (running) {
    runAgain = true
    return
  }
  running = true
  setStatus('syncing')
  try {
    // A session is required to talk to the API; without one the app simply
    // stays local-only until the user signs in.
    if ((await kvGet(KV.sessionToken)) === null) {
      setStatus('idle')
      return
    }

    await backfillAddresses()

    const entries = await db.outbox.orderBy('queuedAt').toArray()
    const ops: SyncOp[] = []
    for (const entry of entries) {
      if (entry.op === 'delete') {
        ops.push({ op: 'delete', noteId: entry.noteId })
      } else {
        const note = await db.notes.get(entry.noteId)
        // The note can be gone if it was deleted after this entry was read;
        // its outbox row was then replaced by a delete op we already carry.
        if (note) ops.push({ op: 'upsert', note })
      }
    }

    const cursorRaw = await kvGet(KV.syncCursor)
    const req: SyncRequest = { ops, since: cursorRaw ? Number(cursorRaw) : null }
    const res = await apiFetch<SyncResponse>('/api/sync', req)

    await applyPull(res, entries.map((e) => [e.noteId, e.queuedAt]))
    setStatus('idle')
  } catch (err) {
    // 401 means the cached session expired server-side: keep local data
    // usable and let the UI offer a re-login. Anything else retries later.
    setStatus(err instanceof ApiError && err.status === 401 ? 'unauthorized' : 'error')
  } finally {
    running = false
    if (runAgain) {
      runAgain = false
      scheduleSync()
    }
  }
}

/**
 * Resolves addresses for queued notes that were created offline, so the
 * upcoming push carries the final payload.
 */
async function backfillAddresses(): Promise<void> {
  // .filter() because `op` is not an indexed column; the outbox is tiny.
  const entries = await db.outbox.filter((e) => e.op === 'upsert').toArray()
  for (const entry of entries) {
    const note = await db.notes.get(entry.noteId)
    if (!note || note.address !== null) continue
    const address = await reverseGeocode(note.lat, note.lng)
    if (address) {
      // Only the address changes; updatedAt moves so other devices pick it up.
      await db.notes.update(note.id, { address, updatedAt: Date.now() })
    }
  }
}

/**
 * Applies the server's pull response to the local store and clears the
 * outbox entries that were successfully pushed.
 *
 * @param res - the sync response.
 * @param pushed - [noteId, queuedAt] pairs that were included in the push;
 *                 an entry is only cleared when its queuedAt is unchanged,
 *                 so edits made while the request was in flight survive.
 */
async function applyPull(res: SyncResponse, pushed: [string, number][]): Promise<void> {
  await db.transaction('rw', db.notes, db.outbox, db.kv, async () => {
    for (const [noteId, queuedAt] of pushed) {
      const current = await db.outbox.get(noteId)
      if (current && current.queuedAt === queuedAt) await db.outbox.delete(noteId)
    }

    // Notes with still-pending outbox entries keep their local state; the
    // next push carries them and last-write-wins settles any conflict.
    const pendingIds = new Set((await db.outbox.toArray()).map((e) => e.noteId))

    const incoming = res.notes.filter((n: Note) => !pendingIds.has(n.id))
    await db.notes.bulkPut(incoming)

    for (const id of res.deletedIds) {
      if (!pendingIds.has(id)) await db.notes.delete(id)
    }

    // A full pull is the complete server state: drop local notes the server
    // no longer has (deletions that happened past the deletion-log window).
    if (res.full) {
      const serverIds = new Set(res.notes.map((n: Note) => n.id))
      const staleIds = (await db.notes.toCollection().primaryKeys()).filter(
        (id) => !serverIds.has(id) && !pendingIds.has(id),
      )
      await db.notes.bulkDelete(staleIds)
    }

    await kvSet(KV.syncCursor, String(res.cursor))
  })
}

/**
 * Wires the automatic sync triggers: app start and connectivity regained.
 * Call once at startup.
 */
export function initSync(): void {
  window.addEventListener('online', () => void syncNow())
  void syncNow()
}
