import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/router'
import { createSession } from '../worker/_lib/session'
import { createTestDb, insertUser, TEST_ORIGIN, type TestDb } from './support/d1'
import type { Note, SyncOp, SyncResponse } from '../shared/types'

/**
 * Sync engine tests against real SQLite, driven through the router.
 *
 * Every rule the sync protocol relies on is expressed as a WHERE clause inside a
 * conditional upsert: last-write-wins, immutable coordinates, per-user
 * ownership, and "only log a deletion that actually deleted something". None of
 * that is visible in the TypeScript, so a fake `DB.prepare` that records bind
 * arguments proves nothing about it. These run the statements for real.
 */

const USER = 'user-a'
const OTHER_USER = 'user-b'

let ctx: TestDb
/** Session cookie header value for USER, reissued for each test. */
let cookie: string

beforeEach(async () => {
  ctx = await createTestDb()
  await insertUser(ctx.db, USER, 'a@example.com')
  await insertUser(ctx.db, OTHER_USER, 'b@example.com')
  cookie = await signIn(USER)
})

afterEach(async () => {
  await ctx.dispose()
})

/**
 * Creates a session for a user and returns a usable Cookie header value.
 *
 * @param userId The user to sign in.
 * @returns The `name=value` pair from the Set-Cookie header.
 */
async function signIn(userId: string): Promise<string> {
  const setCookie = await createSession(ctx.env, userId, new Request(`${TEST_ORIGIN}/api/sync`))
  return setCookie.split(';')[0]
}

/**
 * Posts a raw sync body through the router.
 *
 * @param body Arbitrary JSON body, so invalid input can be exercised too.
 * @param as Cookie header to authenticate with; defaults to USER's session.
 * @returns The router's response.
 */
async function post(body: unknown, as: string | null = cookie): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: TEST_ORIGIN,
    'Content-Type': 'application/json',
  }
  if (as) headers.Cookie = as
  return app.request('/api/sync', { method: 'POST', headers, body: JSON.stringify(body) }, ctx.env)
}

/**
 * Posts a well-formed sync request and asserts it succeeded.
 *
 * @param ops Mutations to push.
 * @param since Client cursor, or null for a full pull.
 * @param as Cookie header to authenticate with.
 * @returns The decoded sync response.
 */
async function sync(ops: SyncOp[], since: number | null = null, as = cookie): Promise<SyncResponse> {
  const res = await post({ ops, since }, as)
  expect(res.status).toBe(200)
  return (await res.json()) as SyncResponse
}

/**
 * Builds a note with sensible defaults.
 *
 * @param id Note id.
 * @param overrides Fields to change.
 * @returns A complete note in API shape.
 */
function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    text: 'hello',
    lat: 10,
    lng: 20,
    address: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('sync push', () => {
  it('stores a new note and returns it on a full pull', async () => {
    await sync([{ op: 'upsert', note: note('n1', { text: 'first' }) }])

    const res = await sync([], null)
    expect(res.full).toBe(true)
    expect(res.notes).toHaveLength(1)
    expect(res.notes[0]).toMatchObject({ id: 'n1', text: 'first', lat: 10, lng: 20 })
  })

  it('applies a newer update but ignores a stale one', async () => {
    await sync([{ op: 'upsert', note: note('n1', { text: 'v1', updatedAt: 1000 }) }])
    await sync([{ op: 'upsert', note: note('n1', { text: 'v2', updatedAt: 2000 }) }])
    // Last-write-wins is decided by updatedAt, not by arrival order, so a late
    // push from a device that was offline must not clobber newer text.
    await sync([{ op: 'upsert', note: note('n1', { text: 'stale', updatedAt: 1500 }) }])

    const res = await sync([], null)
    expect(res.notes[0].text).toBe('v2')
  })

  it('ignores an update with an equal updatedAt', async () => {
    // The upsert guard is strictly greater-than, so a replayed identical push is
    // a no-op rather than a rewrite.
    await sync([{ op: 'upsert', note: note('n1', { text: 'original', updatedAt: 1000 }) }])
    await sync([{ op: 'upsert', note: note('n1', { text: 'replayed', updatedAt: 1000 }) }])

    const res = await sync([], null)
    expect(res.notes[0].text).toBe('original')
  })

  it('never moves a note that already exists', async () => {
    // Coordinates are immutable after creation: the upsert's DO UPDATE list
    // deliberately omits lat/lng, so a client cannot relocate a synced note.
    await sync([{ op: 'upsert', note: note('n1', { lat: 10, lng: 20, updatedAt: 1000 }) }])
    await sync([{ op: 'upsert', note: note('n1', { lat: 55, lng: 66, updatedAt: 2000 }) }])

    const res = await sync([], null)
    expect(res.notes[0]).toMatchObject({ lat: 10, lng: 20 })
  })

  it('does not let one user overwrite another user’s note', async () => {
    await sync([{ op: 'upsert', note: note('shared-id', { text: 'mine', updatedAt: 1000 }) }])

    // Note ids are client-generated, so a malicious client can reuse one it has
    // seen. The upsert's user_id guard is what stops the cross-account write.
    await sync(
      [{ op: 'upsert', note: note('shared-id', { text: 'stolen', updatedAt: 9000 }) }],
      null,
      await signIn(OTHER_USER),
    )

    const res = await sync([], null)
    expect(res.notes[0].text).toBe('mine')
  })

  it('updates text and address together', async () => {
    await sync([{ op: 'upsert', note: note('n1', { address: 'Old St', updatedAt: 1000 }) }])
    await sync([
      { op: 'upsert', note: note('n1', { text: 'new', address: 'New Ave', updatedAt: 2000 }) },
    ])

    const res = await sync([], null)
    expect(res.notes[0]).toMatchObject({ text: 'new', address: 'New Ave' })
  })
})

describe('sync delete', () => {
  it('removes the note and reports it to other devices', async () => {
    await sync([{ op: 'upsert', note: note('n1') }])
    const cursor = (await sync([], null)).cursor

    await sync([{ op: 'delete', noteId: 'n1' }])

    const res = await sync([], cursor)
    expect(res.notes).toHaveLength(0)
    expect(res.deletedIds).toContain('n1')
  })

  it('logs nothing when deleting an id that was never synced', async () => {
    // The deletion log is an INSERT..SELECT from notes, so a delete for an
    // unknown id writes no row. Otherwise every note created and deleted while
    // offline would leave permanent litter in the log.
    const cursor = (await sync([], null)).cursor
    await sync([{ op: 'delete', noteId: 'never-existed' }])

    const res = await sync([], cursor)
    expect(res.deletedIds).toHaveLength(0)
  })

  it('does not let one user delete another user’s note', async () => {
    await sync([{ op: 'upsert', note: note('n1', { text: 'mine' }) }])

    await sync([{ op: 'delete', noteId: 'n1' }], null, await signIn(OTHER_USER))

    const res = await sync([], null)
    expect(res.notes).toHaveLength(1)
    expect(res.notes[0].text).toBe('mine')
  })
})

describe('sync pull', () => {
  it('returns only notes written after the cursor', async () => {
    await sync([{ op: 'upsert', note: note('old') }])
    const cursor = (await sync([], null)).cursor
    // synced_at is stamped with Date.now(), so without this gap a same-
    // millisecond write would land on the wrong side of the cursor comparison.
    await new Promise((resolve) => setTimeout(resolve, 2))
    await sync([{ op: 'upsert', note: note('new') }])

    const res = await sync([], cursor)
    expect(res.full).toBe(false)
    expect(res.notes.map((n) => n.id)).toEqual(['new'])
  })

  it('forces a full pull for a cursor older than the deletion-log margin', async () => {
    await sync([{ op: 'upsert', note: note('n1') }])
    // Past the safety margin the deletion log may already have been pruned, so
    // a delta pull could silently miss deletions. Falling back to the full list
    // is the correctness guarantee.
    const ancient = Date.now() - 26 * 24 * 60 * 60 * 1000

    const res = await sync([], ancient)
    expect(res.full).toBe(true)
    expect(res.notes).toHaveLength(1)
  })

  it('scopes the pull to the calling user', async () => {
    await sync([{ op: 'upsert', note: note('mine') }])

    const res = await sync([], null, await signIn(OTHER_USER))

    expect(res.notes).toHaveLength(0)
  })
})

describe('sync validation', () => {
  it.each([
    ['a non-object body', 'nope'],
    ['a missing ops array', { since: null }],
    ['a non-numeric cursor', { ops: [], since: 'yesterday' }],
    ['an unknown op type', { ops: [{ op: 'patch' }], since: null }],
    [
      'an out-of-range latitude',
      { ops: [{ op: 'upsert', note: { ...note('n1'), lat: 91 } }], since: null },
    ],
    [
      'an out-of-range longitude',
      { ops: [{ op: 'upsert', note: { ...note('n1'), lng: -181 } }], since: null },
    ],
    ['empty note text', { ops: [{ op: 'upsert', note: { ...note('n1'), text: '' } }], since: null }],
    ['a delete without an id', { ops: [{ op: 'delete' }], since: null }],
  ])('rejects %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400)
  })

  it('rejects more ops than the batch limit allows', async () => {
    // The cap bounds the D1 batch size; without it one request could push an
    // unbounded transaction.
    const ops = Array.from({ length: 501 }, (_, i) => ({ op: 'upsert', note: note(`n${i}`) }))
    expect((await post({ ops, since: null })).status).toBe(400)
  })

  it('rejects a request with no session', async () => {
    expect((await post({ ops: [], since: null }, null)).status).toBe(401)
  })
})
