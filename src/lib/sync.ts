import { db, KV, kvGet, kvSet } from './db'
import { ApiError, apiFetch, reverseGeocode } from './api'
import { clearSessionToken } from './native-session'
import type { Note, SyncOp, SyncRequest, SyncResponse } from '../../shared/types'

/** Sync engine state exposed to the UI. */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'unauthorized' | 'revoked'

/** 401 body the server sends when the session was explicitly revoked from
    another device (see SESSION_REVOKED_REASON in worker/_lib/session.ts).
    Distinct from a plain expiry: it triggers a full local wipe, not just a
    re-sign-in prompt. Kept in sync with the server literal by contract. */
const SESSION_REVOKED_REASON = 'session_revoked'

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

/** How many address lookups one sync run may make. Nominatim's usage policy
    allows 1 req/s and the proxy caches by rounded coordinates, so a long
    backlog is spread over several runs rather than sent in one burst. */
const ADDRESS_BACKFILL_LIMIT = 20
/** How long a "no address here" answer stands before it is asked again.
    Matches the geocode proxy's own cache lifetime: asking sooner could only be
    answered from that cache with the same result. */
const MISS_RECHECK_MS = 30 * 24 * 60 * 60 * 1000

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
    status === 'error' && errorSince !== null && Date.now() - errorSince >= SYNC_ERROR_ALERT_MS
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
 * Wipes every trace of the account from this device: all notes, the pending
 * outbox and the account markers (owner hash, e-mail, sync cursor). Makes no
 * network calls, so it works when the session is already gone server-side.
 * Used by an explicit "remove from device" sign-out and by a remote revocation,
 * so a lost or shared device that is signed out from elsewhere drops its local
 * data on its next contact with the server.
 */
export async function wipeLocalAccountData(): Promise<void> {
  await db.transaction('rw', db.notes, db.outbox, db.kv, db.addressMisses, async () => {
    await db.notes.clear()
    await db.outbox.clear()
    // Cached answers about notes that no longer exist here.
    await db.addressMisses.clear()
    // No account owns notes on this device anymore.
    await kvSet(KV.notesOwnerHash, null)
    // Clear the account link and the account-scoped sync cursor; a later
    // sign-in reconciles from scratch.
    await kvSet(KV.userEmail, null)
    await kvSet(KV.syncCursor, null)
  })
  // The account is gone from this device, so the native bearer token (issued for
  // this now-revoked session) must go too, or apiFetch keeps presenting a dead
  // token. No-op on web, where the session lived in the cookie. Outside the
  // Dexie transaction above because it is a native-plugin call, not a DB write.
  await clearSessionToken()
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
      await clearFailure()
      if (err.message === SESSION_REVOKED_REASON) {
        // Signed out from another device ("sign out other devices" / revoke).
        // Wipe every trace of the account from this device, then surface the
        // terminal revoked state. The wipe clears the account marker, so the
        // shell drops back to signed-out, empty local mode on its own.
        await wipeLocalAccountData()
        setStatus('revoked')
      } else {
        // The cached session merely expired server-side: a distinct state with
        // its own re-login prompt, not a "sync is failing" error, and local
        // notes are kept so a fresh sign-in resumes where the user left off.
        setStatus('unauthorized')
      }
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
 * Resolves addresses for notes that have none, so a note written offline stops
 * showing bare coordinates once a connection is available.
 *
 * Every address-less note is a candidate, not only those still in the outbox. A
 * note created offline is pushed on the first sync after the connection
 * returns, and its outbox entry is cleared by that push; if the geocoder was
 * not reachable in that same run (the browser reports itself online the instant
 * a radio comes back, well before requests succeed) the note used to lose its
 * only chance and keep its coordinates forever.
 *
 * Coordinates the geocoder has answered "nothing here" for are remembered and
 * skipped, so open ocean costs one request rather than one per sync. That
 * answer is re-asked after MISS_RECHECK_MS, since the map is redrawn over time
 * and today's blank is not permanent.
 */
async function backfillAddresses(): Promise<void> {
  // .filter() because `address` is not an indexed column.
  const notes = await db.notes.filter((n) => n.address === null).toArray()
  if (notes.length === 0) return

  const misses = new Map(
    (await db.addressMisses.toArray()).map((m) => [m.noteId, m.checkedAt] as const),
  )
  const now = Date.now()
  const owner = await kvGet(KV.notesOwnerHash)
  let asked = 0

  for (const note of notes) {
    if (asked >= ADDRESS_BACKFILL_LIMIT) break
    const missedAt = misses.get(note.id)
    if (missedAt !== undefined && now - missedAt < MISS_RECHECK_MS) continue

    asked++
    const outcome = await reverseGeocode(note.lat, note.lng)
    // Nothing is reachable, so the remaining notes would only repeat this
    // failure. They keep their place and the next sync picks them up.
    if (outcome.status === 'unavailable') return
    if (outcome.status === 'nowhere') {
      await db.addressMisses.put({ noteId: note.id, checkedAt: Date.now() })
      continue
    }

    await db.transaction('rw', db.notes, db.outbox, db.addressMisses, async () => {
      // Only the address changes; updatedAt moves so other devices pick it up.
      const changed = await db.notes.update(note.id, {
        address: outcome.address,
        updatedAt: Date.now(),
      })
      if (changed === 0) return // deleted while the lookup was in flight
      // The note may already have been pushed without its address, in which
      // case nothing else would ever send it. Queueing an upsert covers that
      // and merely refreshes the timestamp on an entry that is still pending.
      await db.outbox.put({ noteId: note.id, op: 'upsert', queuedAt: Date.now(), owner })
      // A spot that once had no address now has one; drop the stale answer.
      await db.addressMisses.delete(note.id)
    })
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
