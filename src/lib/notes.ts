import { db, KV, kvGet } from './db'
import { scheduleSync } from './sync'
import { uuid } from './uuid'
import { NOTE_MAX_LENGTH, type Note } from '../../shared/types'

/**
 * Reads the hash of the account that currently owns notes on this device, used
 * to stamp new outbox entries so a later account switch never uploads them
 * under the wrong account. Must be called inside a transaction that has db.kv
 * in scope so the read joins the same transaction.
 *
 * @returns the owner hash, or null while local-only (no account yet).
 */
async function currentOwner(): Promise<string | null> {
  return kvGet(KV.notesOwnerHash)
}

/**
 * Creates a note at a locked location and queues it for sync.
 *
 * @param text - note text (trimmed, capped at 512 chars by the UI).
 * @param lat/lng - the locked coordinates; immutable afterwards.
 * @param address - reverse-geocoded address, or null when offline.
 * @returns the created note.
 */
export async function createNote(
  text: string,
  lat: number,
  lng: number,
  address: string | null,
): Promise<Note> {
  const now = Date.now()
  const note: Note = {
    id: uuid(),
    text: text.slice(0, NOTE_MAX_LENGTH),
    lat,
    lng,
    address,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.notes, db.outbox, db.kv, async () => {
    await db.notes.put(note)
    await db.outbox.put({ noteId: note.id, op: 'upsert', queuedAt: now, owner: await currentOwner() })
  })
  scheduleSync()
  return note
}

/**
 * Updates a note's text (location is immutable) and queues it for sync.
 *
 * @param id - the note id.
 * @param text - the new text.
 */
export async function updateNoteText(id: string, text: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.notes, db.outbox, db.kv, async () => {
    const changed = await db.notes.update(id, {
      text: text.slice(0, NOTE_MAX_LENGTH),
      updatedAt: now,
    })
    if (changed === 0) return // note was deleted meanwhile
    await db.outbox.put({ noteId: id, op: 'upsert', queuedAt: now, owner: await currentOwner() })
  })
  scheduleSync()
}

/**
 * Hard-deletes a note locally and queues the server-side hard delete.
 * There is no trash bin: once synced, the data is gone everywhere.
 *
 * @param id - the note id.
 */
export async function deleteNote(id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.outbox, db.kv, async () => {
    await db.notes.delete(id)
    // Replaces any pending upsert for this note: deleting an unsynced note
    // results in a delete op the server treats as a harmless no-op.
    await db.outbox.put({ noteId: id, op: 'delete', queuedAt: Date.now(), owner: await currentOwner() })
  })
  scheduleSync()
}
