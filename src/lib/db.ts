import Dexie, { type Table } from 'dexie'
import type { Note } from '../../shared/types'

/** A pending local mutation waiting to be pushed to the server.
    One entry per note: a later delete replaces a pending upsert. */
export interface OutboxEntry {
  noteId: string
  op: 'upsert' | 'delete'
  queuedAt: number
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
  }
}

export const db = new GeoNotesDb()

/** Keys used in the kv table. */
export const KV = {
  sessionToken: 'sessionToken',
  userEmail: 'userEmail',
  syncCursor: 'syncCursor',
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
