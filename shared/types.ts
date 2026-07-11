// Types shared between the web app (src/) and the Pages Functions (functions/).

/** A location-pinned note. Ids are client-generated UUIDs so notes can be created offline. */
export interface Note {
  id: string
  /** Plain text, max 512 chars, only **bold** markup allowed. */
  text: string
  /** Latitude at creation time. Immutable after creation. */
  lat: number
  /** Longitude at creation time. Immutable after creation. */
  lng: number
  /** Reverse-geocoded human-readable place, null until resolved. */
  address: string | null
  /** Epoch milliseconds. */
  createdAt: number
  /** Epoch milliseconds, drives last-write-wins conflict resolution. */
  updatedAt: number
}

/** Maximum allowed note length in characters. */
export const NOTE_MAX_LENGTH = 512

/** One client mutation pushed to the server during sync. */
export type SyncOp =
  | { op: 'upsert'; note: Note }
  | { op: 'delete'; noteId: string }

/** Body of POST /api/sync: all pending mutations plus the client's pull cursor. */
export interface SyncRequest {
  ops: SyncOp[]
  /** Epoch ms of the last successful pull, or null for a first/full sync. */
  since: number | null
}

/** Response of POST /api/sync: everything that changed server-side since `since`. */
export interface SyncResponse {
  /** Notes created or updated after `since` (full list when `full` is true). */
  notes: Note[]
  /** Ids hard-deleted after `since`. Empty when `full` is true. */
  deletedIds: string[]
  /** New cursor the client must store for the next delta pull. */
  cursor: number
  /** True when the server returned the complete note list; the client must
      then drop any local note (without pending changes) missing from it. */
  full: boolean
}
