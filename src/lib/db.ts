import Dexie, { type Table } from 'dexie'
import type { Note } from '../../shared/types'

/** A pending local mutation waiting to be pushed to the server.
    One entry per note: a later delete replaces a pending upsert. */
export interface OutboxEntry {
  noteId: string
  op: 'upsert' | 'delete'
  queuedAt: number
  // Opaque hash of the account that owns this pending change (see
  // KV.notesOwnerHash), or null when it was queued local-only before any
  // sign-in. The sync push only sends entries owned by the account it is
  // authenticated as, so switching accounts on a device never uploads the
  // previous account's unsynced notes under the new account. Null entries are
  // claimed by the first account to sign in.
  owner: string | null
}

/** Small key/value rows for session token, sync cursor, user e-mail, etc. */
export interface KvEntry {
  key: string
  value: string
}

/** Local IndexedDB store: the source of truth the UI always reads from. */
class GeoNotesDb extends Dexie {
  notes!: Table<Note, string>
  outbox!: Table<OutboxEntry, string>
  kv!: Table<KvEntry, string>

  constructor() {
    super('geonotes')
    this.version(1).stores({
      notes: 'id, updatedAt',
      outbox: 'noteId, queuedAt',
      kv: 'key',
    })
    this.version(2)
      .stores({
        notes: 'id, updatedAt',
        outbox: 'noteId, queuedAt',
        kv: 'key',
      })
      .upgrade((transaction) => transaction.table('kv').delete('sessionToken'))
    // v3 adds OutboxEntry.owner. Existing pending entries can only belong to the
    // account whose notes are currently on this device, so backfill them with
    // that owner hash (null when the device is local-only), which the sync push
    // now uses to avoid uploading them under a different account.
    this.version(3)
      .stores({
        notes: 'id, updatedAt',
        outbox: 'noteId, queuedAt',
        kv: 'key',
      })
      .upgrade(async (transaction) => {
        const owner =
          ((await transaction.table('kv').get('notesOwnerHash')) as KvEntry | undefined)?.value ??
          null
        await transaction
          .table('outbox')
          .toCollection()
          .modify((entry: OutboxEntry) => {
            entry.owner = owner
          })
      })
  }
}

export const db = new GeoNotesDb()

/** Keys used in the kv table. */
export const KV = {
  userEmail: 'userEmail',
  syncCursor: 'syncCursor',
  // When the current run of sync failures began (epoch ms), or absent when the
  // last sync succeeded. Persisted so the "sync is failing" alert threshold
  // measures real elapsed time across reloads.
  syncErrorSince: 'syncErrorSince',
  // Opaque hash of the account whose notes are currently on this device. A
  // hash (not the e-mail) so no personal information of the previous account
  // is left on the device. Kept across a "keep notes" sign-out so the next
  // sign-in can detect an account switch that would discard those notes.
  notesOwnerHash: 'notesOwnerHash',
} as const

/**
 * Reads a value from the kv table.
 *
 * @param key - one of the KV constants.
 * @returns the stored string or null.
 */
export async function kvGet(key: string): Promise<string | null> {
  const row = await db.kv.get(key)
  return row?.value ?? null
}

/**
 * Writes a value to the kv table.
 *
 * @param key - one of the KV constants.
 * @param value - string to store, or null to delete the key.
 */
export async function kvSet(key: string, value: string | null): Promise<void> {
  if (value === null) await db.kv.delete(key)
  else await db.kv.put({ key, value })
}
