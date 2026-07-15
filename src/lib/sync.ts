import { db, KV, kvGet, kvSet } from './db'
import { ApiError, apiFetch, reverseGeocode } from './api'
import type { Note, SyncOp, SyncRequest, SyncResponse } from '../../shared/types'

/** Sync engine state exposed to the UI. */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'unauthorized'

/** Snapshot the UI subscribes to: the raw status plus whether a sync error has
    persisted long enough to be worth telling the user about. */
export interface SyncSnapshot {
  status: SyncStatus
  alerting: boolean
}

/** While a sync keeps failing, retry on this cadence so a recovered network or
    server clears the error on its own, without the user doing anything. */
const SYNC_ERROR_RETRY_MS = 5 * 60 * 1000
/** Only surface a sync error to the user once it has been failing this long,
    so a brief blip never raises a banner. */
const SYNC_ERROR_ALERT_MS = 2 * 60 * 60 * 1000

let status: SyncStatus = 'idle'
// When the current run of failures began, or null when the last sync
// succeeded. Persisted (see KV.syncErrorSince) so the alert threshold measures
// real elapsed time across reloads.
let errorSince: number | null = null
let snapshot: SyncSnapshot = { status, alerting: false }
const listeners = new Set<() => void>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let runAgain = false

/**
 * Subscribes to sync snapshot changes (for React's useSyncExternalStore).
 *
 * @param listener - called whenever the snapshot changes.
 * @returns an unsubscribe function.
 */
export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Returns the current sync snapshot (for React's useSyncExternalStore). The
 * reference only changes when a field changes, so it is safe as a store value.
 */
export function getSyncSnapshot(): SyncSnapshot {
  return snapshot
}

/**
 * Recomputes the alert flag from the current status and failure age and, when
 * the snapshot actually changed, publishes a fresh one to subscribers.
 */
function recompute(): void {
  const alerting =
    status !== 'unauthorized' &&
    errorSince !== null &&
    Date.now() - errorSince >= SYNC_ERROR_ALERT_MS
  if (snapshot.status !== status || snapshot.alerting !== alerting) {
    snapshot = { status, alerting }
    for (const l of listeners) l()
  }
}

/**
 * Updates the status and refreshes the published snapshot.
 *
 * @param next - the new status.
 */
function setStatus(next: SyncStatus): void {
  status = next
  recompute()
}

/**
 * Marks the current sync as failed, starting the failure streak (persisted) if
 * one is not already running, so the alert threshold counts from the first
 * failure rather than the latest.
 */
async function markFailure(): Promise<void> {
  if (errorSince !== null) return
  errorSince = Date.now()
  await kvSet(KV.syncErrorSince, String(errorSince))
}

/**
 * Clears the failure streak after a successful (or not-applicable) sync.
 */
async function clearFailure(): Promise<void> {
  if (errorSince === null) return
  errorSince = null
  await kvSet(KV.syncErrorSince, null)
}

/**
 * Schedules a background retry while a sync is failing, so recovery needs no
 * user action.
 */
function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void syncNow()
  }, SYNC_ERROR_RETRY_MS)
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
  // A run supersedes any pending retry; a new one is scheduled below if it fails.
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  setStatus('syncing')
  try {
    // Addresses matter even without an account (the geocode proxy is public),
    // so the backfill runs before the session gate.
    await backfillAddresses()

    // A session is required for push/pull; without one the app simply stays
    // local-only, mutations accumulating in the outbox until a sign-in.
    if ((await kvGet(KV.userEmail)) === null) {
      await clearFailure()
      setStatus('idle')
      return
    }

    // Only push entries the session actually owns. userEmail is set together
    // with notesOwnerHash by establishSession, after the server has confirmed
    // the session cookie for that same account, so the cookie in flight always
    // matches this owner. Entries tagged to a different account (a previous
    // account's unsynced notes still on the device) are held back rather than
    // uploaded under the current account. Null-owner entries are local-only
    // drafts this first sign-in claims.
    const owner = await kvGet(KV.notesOwnerHash)
    const entries = (await db.outbox.orderBy('queuedAt').toArray()).filter(
      (e) => e.owner === owner || e.owner === null,
    )
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
    await clearFailure()
    setStatus('idle')
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // The cached session expired server-side: a distinct state with its own
      // re-login prompt, not a "sync is failing" error.
      await clearFailure()
      setStatus('unauthorized')
    } else {
      // Record the failure and keep retrying in the background; the banner only
      // appears once the streak is old enough (see recompute).
      await markFailure()
      setStatus('error')
      scheduleRetry()
    }
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
  // Restore any in-progress failure streak so the alert threshold survives a
  // reload, then run the first sync.
  void (async () => {
    const raw = await kvGet(KV.syncErrorSince)
    if (raw) {
      errorSince = Number(raw)
      recompute()
    }
    await syncNow()
  })()
}
