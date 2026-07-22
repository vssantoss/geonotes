import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ABANDONED_ACCOUNT_TTL_MS,
  DELETION_GRACE_MS,
  purgeAbandonedAccounts,
  purgeExpiredDeletedAccounts,
  requestAccountDeletion,
} from '../worker/_lib/account-deletion'
import { createSession, requireUser, SESSION_REVOKED_REASON } from '../worker/_lib/session'
import { claimEmailCodeRequest, issueEmailCode } from '../worker/_lib/email-code'
import { createTestDb, insertUser, TEST_ORIGIN, type TestDb } from './support/d1'

/**
 * Account deletion lifecycle, against real SQLite.
 *
 * Deletion is a two-phase soft delete: requesting it marks the user row and
 * signs every device out, and a daily cron purges the data 30 days later. The
 * risky parts are both in SQL. The purge resolves its victims through subqueries
 * and deletes the user rows last, so a reordering would silently purge nothing;
 * and cancelling by signing back in is a clause buried in createSession.
 */

const USER = 'user-a'
const EMAIL = 'a@example.com'
const KEEPER = 'user-b'
const KEEPER_EMAIL = 'b@example.com'

let ctx: TestDb

beforeEach(async () => {
  ctx = await createTestDb()
  await insertUser(ctx.db, USER, EMAIL)
  await insertUser(ctx.db, KEEPER, KEEPER_EMAIL)
})

afterEach(async () => {
  await ctx.dispose()
})

/**
 * Adds a passkey credential row for a user.
 *
 * @param userId Owner of the credential.
 * @param id Credential id.
 * @returns Nothing.
 */
async function insertCredential(userId: string, id: string): Promise<void> {
  await ctx.db
    .prepare(
      'INSERT INTO credentials (id, user_id, public_key, counter, created_at) VALUES (?, ?, ?, 0, ?)',
    )
    .bind(id, userId, 'pk', Date.now())
    .run()
}

/**
 * Counts rows in a table for a given column value.
 *
 * @param table Table to count in.
 * @param column Column to filter on.
 * @param value Value to match.
 * @returns The row count.
 */
async function count(table: string, column: string, value: string): Promise<number> {
  const row = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
    .bind(value)
    .first<{ n: number }>()
  return row?.n ?? 0
}

describe('requesting deletion', () => {
  it('returns the address and marks the account', async () => {
    const now = Date.now()

    expect(await requestAccountDeletion(ctx.env, USER, now)).toBe(EMAIL)

    const row = await ctx.db
      .prepare('SELECT deletion_requested_at FROM users WHERE id = ?')
      .bind(USER)
      .first<{ deletion_requested_at: number | null }>()
    expect(row?.deletion_requested_at).toBe(now)
  })

  it('signs out every device and removes every passkey', async () => {
    await createSession(ctx.env, USER, new Request(`${TEST_ORIGIN}/api/sync`))
    await createSession(ctx.env, USER, new Request(`${TEST_ORIGIN}/api/sync`))
    await insertCredential(USER, 'cred-1')

    await requestAccountDeletion(ctx.env, USER, Date.now())

    // No device may stay authenticated against a doomed account, and dropping
    // the passkeys forces reactivation through the e-mail recovery flow. The
    // session rows survive as revoked tombstones on purpose: see the wipe test
    // below for why deleting them outright would leave data on the devices.
    const sessions = await ctx.env.DB.prepare(
      'SELECT revoked_at FROM sessions WHERE user_id = ?',
    )
      .bind(USER)
      .all<{ revoked_at: number | null }>()
    expect(sessions.results).toHaveLength(2)
    expect(sessions.results.every((row) => row.revoked_at !== null)).toBe(true)
    expect(await count('credentials', 'user_id', USER)).toBe(0)
  })

  it('keeps the user row so the address stays reserved', async () => {
    await requestAccountDeletion(ctx.env, USER, Date.now())

    expect(await count('users', 'id', USER)).toBe(1)
  })

  it('keeps the notes until the purge', async () => {
    await ctx.db
      .prepare(
        'INSERT INTO notes (id, user_id, text, lat, lng, created_at, updated_at, synced_at) VALUES (?, ?, ?, 0, 0, 0, 0, 0)',
      )
      .bind('n1', USER, 'still here')
      .run()

    await requestAccountDeletion(ctx.env, USER, Date.now())

    expect(await count('notes', 'user_id', USER)).toBe(1)
  })

  it('returns null for an unknown user', async () => {
    expect(await requestAccountDeletion(ctx.env, 'nobody', Date.now())).toBeNull()
  })

  it('leaves other accounts untouched', async () => {
    await createSession(ctx.env, KEEPER, new Request(`${TEST_ORIGIN}/api/sync`))

    await requestAccountDeletion(ctx.env, USER, Date.now())

    expect(await count('sessions', 'user_id', KEEPER)).toBe(1)
  })
})

describe('cancelling by signing back in', () => {
  it('clears the mark when a new session is created', async () => {
    await requestAccountDeletion(ctx.env, USER, Date.now())

    await createSession(ctx.env, USER, new Request(`${TEST_ORIGIN}/api/sync`))

    const row = await ctx.db
      .prepare('SELECT deletion_requested_at FROM users WHERE id = ?')
      .bind(USER)
      .first<{ deletion_requested_at: number | null }>()
    expect(row?.deletion_requested_at).toBeNull()
  })

  it('saves the account from a later purge', async () => {
    const requestedAt = Date.now() - DELETION_GRACE_MS - 1000
    await requestAccountDeletion(ctx.env, USER, requestedAt)
    await createSession(ctx.env, USER, new Request(`${TEST_ORIGIN}/api/sync`))

    await purgeExpiredDeletedAccounts(ctx.env, Date.now())

    expect(await count('users', 'id', USER)).toBe(1)
  })
})

describe('purging after the grace window', () => {
  it('leaves an account whose window has not elapsed', async () => {
    const now = Date.now()
    await requestAccountDeletion(ctx.env, USER, now - DELETION_GRACE_MS + 1000)

    await purgeExpiredDeletedAccounts(ctx.env, now)

    expect(await count('users', 'id', USER)).toBe(1)
  })

  it('removes the account and all of its data once the window has elapsed', async () => {
    const now = Date.now()
    await insertCredential(USER, 'cred-1')
    await ctx.db
      .prepare(
        'INSERT INTO notes (id, user_id, text, lat, lng, created_at, updated_at, synced_at) VALUES (?, ?, ?, 0, 0, 0, 0, 0)',
      )
      .bind('n1', USER, 'gone')
      .run()
    await ctx.db
      .prepare('INSERT INTO deleted_notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .bind('n0', USER, now)
      .run()
    await issueEmailCode(ctx.env, EMAIL, now)
    await claimEmailCodeRequest(ctx.env, EMAIL, now)
    await requestAccountDeletion(ctx.env, USER, now - DELETION_GRACE_MS - 1000)

    await purgeExpiredDeletedAccounts(ctx.env, now)

    // Nothing keyed on either the user id or the address may survive, or the
    // account would be only partly forgotten.
    expect(await count('users', 'id', USER)).toBe(0)
    expect(await count('credentials', 'user_id', USER)).toBe(0)
    expect(await count('notes', 'user_id', USER)).toBe(0)
    expect(await count('deleted_notes', 'user_id', USER)).toBe(0)
    expect(await count('email_codes', 'email', EMAIL)).toBe(0)
    expect(await count('email_code_rate_limits', 'email', EMAIL)).toBe(0)
  })

  it('never touches an account that was not marked', async () => {
    await insertCredential(KEEPER, 'cred-keep')
    await requestAccountDeletion(ctx.env, USER, Date.now() - DELETION_GRACE_MS - 1000)

    await purgeExpiredDeletedAccounts(ctx.env, Date.now())

    expect(await count('users', 'id', KEEPER)).toBe(1)
    expect(await count('credentials', 'user_id', KEEPER)).toBe(1)
  })

  it('frees the address for a fresh sign-up', async () => {
    await requestAccountDeletion(ctx.env, USER, Date.now() - DELETION_GRACE_MS - 1000)
    await purgeExpiredDeletedAccounts(ctx.env, Date.now())

    // The users.email unique constraint would reject this while the old row
    // still existed, which is exactly what reserves the address during the
    // grace window.
    await expect(insertUser(ctx.db, 'user-new', EMAIL)).resolves.toBeUndefined()
  })

  it('is safe to run when nothing is due', async () => {
    // The cron fires daily whether or not anything is pending.
    await expect(purgeExpiredDeletedAccounts(ctx.env, Date.now())).resolves.toBeUndefined()

    expect(await count('users', 'id', USER)).toBe(1)
  })
})

/**
 * Overwrites a user's creation timestamp, so a test can age an account past the
 * abandonment cutoff without waiting.
 *
 * @param userId The account to backdate.
 * @param createdAt The creation timestamp to set.
 * @returns Nothing.
 */
async function setUserCreatedAt(userId: string, createdAt: number): Promise<void> {
  await ctx.db
    .prepare('UPDATE users SET created_at = ? WHERE id = ?')
    .bind(createdAt, userId)
    .run()
}

/**
 * Inserts a session row with an explicit creation time, standing in for a login
 * at that moment.
 *
 * @param userId Owner of the session.
 * @param tokenHash Unique session token hash.
 * @param createdAt When the session (login) was created.
 * @returns Nothing.
 */
async function insertSession(userId: string, tokenHash: string, createdAt: number): Promise<void> {
  await ctx.db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, userId, createdAt + DELETION_GRACE_MS, createdAt)
    .run()
}

/**
 * Inserts a note owned by a user.
 *
 * @param userId Owner of the note.
 * @param id Note id.
 * @returns Nothing.
 */
async function insertNote(userId: string, id: string): Promise<void> {
  await ctx.db
    .prepare(
      'INSERT INTO notes (id, user_id, text, lat, lng, created_at, updated_at, synced_at) VALUES (?, ?, ?, 0, 0, 0, 0, 0)',
    )
    .bind(id, userId, 'note')
    .run()
}

describe('purging abandoned accounts', () => {
  it('removes a credential-less, note-less account idle past the TTL', async () => {
    const now = Date.now()
    // No credential and no session: idleness falls back to the creation time.
    await setUserCreatedAt(USER, now - ABANDONED_ACCOUNT_TTL_MS - 1000)

    await purgeAbandonedAccounts(ctx.env, now)

    expect(await count('users', 'id', USER)).toBe(0)
  })

  it('keeps a freshly created account that has not aged out', async () => {
    const now = Date.now()
    await setUserCreatedAt(USER, now - ABANDONED_ACCOUNT_TTL_MS + 1000)

    await purgeAbandonedAccounts(ctx.env, now)

    expect(await count('users', 'id', USER)).toBe(1)
  })

  it('spares an old account that still owns a passkey', async () => {
    const now = Date.now()
    await setUserCreatedAt(USER, now - ABANDONED_ACCOUNT_TTL_MS - 1000)
    await insertCredential(USER, 'cred-1')

    await purgeAbandonedAccounts(ctx.env, now)

    expect(await count('users', 'id', USER)).toBe(1)
  })

  it('spares an old account that still owns a note', async () => {
    const now = Date.now()
    await setUserCreatedAt(USER, now - ABANDONED_ACCOUNT_TTL_MS - 1000)
    await insertNote(USER, 'n1')

    await purgeAbandonedAccounts(ctx.env, now)

    expect(await count('users', 'id', USER)).toBe(1)
  })

  it('measures idleness from the last login, not the creation date', async () => {
    const now = Date.now()
    // Created long ago, but signed in recently: a recent login must keep it.
    await setUserCreatedAt(USER, now - ABANDONED_ACCOUNT_TTL_MS * 2)
    await insertSession(USER, 'sess-recent', now - 1000)

    await purgeAbandonedAccounts(ctx.env, now)

    expect(await count('users', 'id', USER)).toBe(1)
  })

  it('removes an account whose last login is itself past the TTL', async () => {
    const now = Date.now()
    await setUserCreatedAt(USER, now - ABANDONED_ACCOUNT_TTL_MS * 2)
    await insertSession(USER, 'sess-old', now - ABANDONED_ACCOUNT_TTL_MS - 1000)

    await purgeAbandonedAccounts(ctx.env, now)

    // The session tombstone must go with it, leaving nothing keyed on the user.
    expect(await count('users', 'id', USER)).toBe(0)
    expect(await count('sessions', 'user_id', USER)).toBe(0)
  })

  it('leaves accounts in the deletion flow to the deletion purge', async () => {
    const now = Date.now()
    // Marked for deletion within its grace window. requestAccountDeletion drops
    // the passkey, so this is also credential-less and old, but the deletion
    // flow owns it and its grace window must not be short-circuited here.
    await setUserCreatedAt(USER, now - ABANDONED_ACCOUNT_TTL_MS - 1000)
    await requestAccountDeletion(ctx.env, USER, now)

    await purgeAbandonedAccounts(ctx.env, now)

    expect(await count('users', 'id', USER)).toBe(1)
  })

  it('clears the address-keyed e-mail rows it leaves behind', async () => {
    const now = Date.now()
    await setUserCreatedAt(USER, now - ABANDONED_ACCOUNT_TTL_MS - 1000)
    await issueEmailCode(ctx.env, EMAIL, now)
    await claimEmailCodeRequest(ctx.env, EMAIL, now)

    await purgeAbandonedAccounts(ctx.env, now)

    expect(await count('users', 'id', USER)).toBe(0)
    expect(await count('email_codes', 'email', EMAIL)).toBe(0)
    expect(await count('email_code_rate_limits', 'email', EMAIL)).toBe(0)
  })

  it('is safe to run when nothing is abandoned', async () => {
    await insertCredential(USER, 'cred-1')

    await expect(purgeAbandonedAccounts(ctx.env, Date.now())).resolves.toBeUndefined()

    expect(await count('users', 'id', USER)).toBe(1)
    expect(await count('users', 'id', KEEPER)).toBe(1)
  })
})

describe('sessions of a deleted account', () => {
  it('stops authenticating once deletion is requested', async () => {
    const { cookie: setCookie } = await createSession(ctx.env, USER, new Request(`${TEST_ORIGIN}/api/sync`))
    const cookie = setCookie.split(';')[0]

    await requestAccountDeletion(ctx.env, USER, Date.now())

    const request = new Request(`${TEST_ORIGIN}/api/sync`, { headers: { Cookie: cookie } })
    await expect(requireUser(ctx.env, request)).rejects.toMatchObject({ status: 401 })
  })

  it('tells the other devices to wipe, not merely that the session expired', async () => {
    // The distinction is the whole point. A plain 401 leaves the notes of a
    // deleted account sitting on every other device the user was signed in on,
    // because the client keeps local data across an ordinary expiry and only
    // wipes on SESSION_REVOKED_REASON (see the handler in src/lib/sync.ts).
    const { cookie: setCookie } = await createSession(ctx.env, USER, new Request(`${TEST_ORIGIN}/api/sync`))
    const cookie = setCookie.split(';')[0]

    await requestAccountDeletion(ctx.env, USER, Date.now())

    const request = new Request(`${TEST_ORIGIN}/api/sync`, { headers: { Cookie: cookie } })
    await expect(requireUser(ctx.env, request)).rejects.toMatchObject({
      status: 401,
      message: SESSION_REVOKED_REASON,
    })
  })
})
