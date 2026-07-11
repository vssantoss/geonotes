import { json, HttpError, route } from '../_lib/http'
import { requireUser } from '../_lib/session'
import type { Env } from '../_lib/env'
import { NOTE_MAX_LENGTH, type Note, type SyncOp, type SyncRequest, type SyncResponse } from '../../shared/types'

/** Upper bound on ops per request, to bound the D1 batch size. */
const MAX_OPS = 500

/** Deletion log entries older than this are pruned; clients whose cursor is
    older than the safety margin below get a full pull instead. */
const DELETION_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000
const FULL_PULL_THRESHOLD_MS = 25 * 24 * 60 * 60 * 1000

/**
 * POST /api/sync: applies the client's queued mutations and returns server
 * changes since the client's cursor, all in a single request and a single
 * D1 batch to conserve free-tier transactions.
 */
export const onRequestPost = route<Env>(async ({ env, request }) => {
  const userId = await requireUser(env, request)
  const body = validateRequest(await request.json().catch(() => null))
  const now = Date.now()

  if (body.ops.length > 0) {
    const statements = body.ops.flatMap((op) => opStatements(env, userId, op, now))
    // Prune the deletion log only when this push contains deletes, so
    // ordinary syncs cost no extra writes.
    if (body.ops.some((op) => op.op === 'delete')) {
      statements.push(
        env.DB.prepare('DELETE FROM deleted_notes WHERE user_id = ? AND deleted_at < ?').bind(
          userId,
          now - DELETION_LOG_TTL_MS,
        ),
      )
    }
    await env.DB.batch(statements)
  }

  // A cursor older than the deletion-log safety margin cannot trust the log
  // anymore: fall back to the complete list.
  const full = body.since === null || body.since < now - FULL_PULL_THRESHOLD_MS

  const res: SyncResponse = full
    ? {
        notes: await pullNotes(env, userId, null),
        deletedIds: [],
        cursor: now,
        full: true,
      }
    : {
        notes: await pullNotes(env, userId, body.since),
        deletedIds: (
          await env.DB.prepare('SELECT id FROM deleted_notes WHERE user_id = ? AND deleted_at > ?')
            .bind(userId, body.since)
            .all<{ id: string }>()
        ).results.map((r) => r.id),
        cursor: now,
        full: false,
      }
  return json(res)
})

/**
 * Reads a user's notes, optionally only those written after a cursor.
 *
 * @param env - function environment.
 * @param userId - owner.
 * @param since - server-stamp cursor, or null for all notes.
 * @returns notes in API shape.
 */
async function pullNotes(env: Env, userId: string, since: number | null): Promise<Note[]> {
  const sql =
    'SELECT id, text, lat, lng, address, created_at, updated_at FROM notes WHERE user_id = ?' +
    (since !== null ? ' AND synced_at > ?' : '')
  const stmt =
    since !== null ? env.DB.prepare(sql).bind(userId, since) : env.DB.prepare(sql).bind(userId)
  const { results } = await stmt.all<{
    id: string
    text: string
    lat: number
    lng: number
    address: string | null
    created_at: number
    updated_at: number
  }>()
  return results.map((r) => ({
    id: r.id,
    text: r.text,
    lat: r.lat,
    lng: r.lng,
    address: r.address,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

/**
 * Builds the D1 statements for one sync op.
 *
 * Upserts never touch lat/lng on existing rows (locations are immutable),
 * only apply when the incoming updated_at is newer (last-write-wins) and
 * only when the existing row belongs to the caller. Deletes are hard, with
 * the id recorded in the deletion log only when a row was actually removed.
 *
 * @param env - function environment.
 * @param userId - the authenticated owner.
 * @param op - the mutation.
 * @param now - server timestamp used for synced_at / deleted_at.
 * @returns prepared statements to add to the batch.
 */
function opStatements(env: Env, userId: string, op: SyncOp, now: number): D1PreparedStatement[] {
  if (op.op === 'delete') {
    return [
      // INSERT..SELECT only fires when the note exists and is owned by the
      // caller, so deleting never-synced or foreign ids logs nothing.
      env.DB.prepare(
        `INSERT INTO deleted_notes (id, user_id, deleted_at)
         SELECT id, user_id, ? FROM notes WHERE id = ? AND user_id = ?
         ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at`,
      ).bind(now, op.noteId, userId),
      env.DB.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(op.noteId, userId),
    ]
  }
  const n = op.note
  return [
    env.DB.prepare(
      `INSERT INTO notes (id, user_id, text, lat, lng, address, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         address = excluded.address,
         updated_at = excluded.updated_at,
         synced_at = excluded.synced_at
       WHERE notes.user_id = excluded.user_id AND excluded.updated_at > notes.updated_at`,
    ).bind(n.id, userId, n.text, n.lat, n.lng, n.address, n.createdAt, n.updatedAt, now),
  ]
}

/**
 * Validates and narrows the request body.
 *
 * @param body - parsed JSON or null.
 * @returns the typed SyncRequest.
 * @throws HttpError(400) on malformed input.
 */
function validateRequest(body: unknown): SyncRequest {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'bad body')
  const { ops, since } = body as Record<string, unknown>
  if (!Array.isArray(ops) || ops.length > MAX_OPS) throw new HttpError(400, 'bad ops')
  if (since !== null && (typeof since !== 'number' || !Number.isFinite(since))) {
    throw new HttpError(400, 'bad cursor')
  }
  for (const op of ops) validateOp(op)
  return { ops: ops as SyncOp[], since: since as number | null }
}

/**
 * Validates a single sync op in place.
 *
 * @param op - candidate op.
 * @throws HttpError(400) when it is not a valid upsert or delete.
 */
function validateOp(op: unknown): void {
  if (typeof op !== 'object' || op === null) throw new HttpError(400, 'bad op')
  const o = op as Record<string, unknown>
  if (o.op === 'delete') {
    if (!isId(o.noteId)) throw new HttpError(400, 'bad delete id')
    return
  }
  if (o.op !== 'upsert') throw new HttpError(400, 'bad op type')
  const n = o.note as Record<string, unknown> | null
  if (
    typeof n !== 'object' ||
    n === null ||
    !isId(n.id) ||
    typeof n.text !== 'string' ||
    n.text.length === 0 ||
    n.text.length > NOTE_MAX_LENGTH ||
    !isFiniteNumber(n.lat) ||
    (n.lat as number) < -90 ||
    (n.lat as number) > 90 ||
    !isFiniteNumber(n.lng) ||
    (n.lng as number) < -180 ||
    (n.lng as number) > 180 ||
    (n.address !== null && (typeof n.address !== 'string' || n.address.length > 512)) ||
    !isFiniteNumber(n.createdAt) ||
    !isFiniteNumber(n.updatedAt)
  ) {
    throw new HttpError(400, 'bad note')
  }
}

/**
 * Checks that a value is a plausible client-generated note id.
 *
 * @returns true for non-empty strings up to 64 chars.
 */
function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64
}

/**
 * Checks that a value is a finite number.
 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
