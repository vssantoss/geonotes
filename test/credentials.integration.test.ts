import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/router'
import { createSession } from '../worker/_lib/session'
import { createTestDb, insertUser, TEST_ORIGIN, type TestDb } from './support/d1'

/**
 * The settings passkey list and its removal rules, against real SQLite.
 *
 * Which passkey is "in use" is a value carried on the session row from the
 * sign-in ceremony to the credentials endpoint, and the removal guards are two
 * conditions over that value and a COUNT. A fake DB.prepare could only assert
 * the query strings, so the interesting cases (a session naming a credential
 * that has since been deleted, a pre-migration session naming none) need the
 * real database.
 */

const USER = 'user-a'
const EMAIL = 'a@example.com'
const OTHER = 'user-b'
const OTHER_EMAIL = 'b@example.com'

let ctx: TestDb

beforeEach(async () => {
  ctx = await createTestDb()
  await insertUser(ctx.db, USER, EMAIL)
  await insertUser(ctx.db, OTHER, OTHER_EMAIL)
})

afterEach(async () => {
  await ctx.dispose()
})

/**
 * Adds a passkey credential row for a user.
 *
 * @param id Credential id.
 * @param userId Owner of the credential; defaults to USER.
 * @param createdAt Registration time, so list ordering can be controlled.
 * @returns Nothing.
 */
async function insertCredential(id: string, userId = USER, createdAt = Date.now()): Promise<void> {
  await ctx.db
    .prepare(
      'INSERT INTO credentials (id, user_id, public_key, counter, created_at, label) VALUES (?, ?, ?, 0, ?, ?)',
    )
    .bind(id, userId, 'pk', createdAt, `label-${id}`)
    .run()
}

/**
 * Signs a user in, recording which passkey authorized the session.
 *
 * @param credentialId The credential the ceremony used, or undefined to model a
 *   session predating the credential_id column.
 * @param userId The user to sign in; defaults to USER.
 * @returns The `name=value` pair from the Set-Cookie header.
 */
async function signIn(credentialId?: string, userId = USER): Promise<string> {
  const { cookie } = await createSession(
    ctx.env,
    userId,
    new Request(`${TEST_ORIGIN}/api/auth/passkey-login`),
    credentialId,
  )
  return cookie.split(';')[0]
}

/**
 * Fetches the passkey list through the router.
 *
 * @param cookie Session cookie header to authenticate with.
 * @returns The listed credentials.
 */
async function list(
  cookie: string,
): Promise<{ id: string; label: string | null; created_at: number; current: boolean }[]> {
  const res = await app.request(
    '/api/auth/credentials',
    { headers: { Origin: TEST_ORIGIN, Cookie: cookie } },
    ctx.env,
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    credentials: { id: string; label: string | null; created_at: number; current: boolean }[]
  }
  return body.credentials
}

/**
 * Attempts to remove a passkey through the router.
 *
 * @param id Credential id to remove.
 * @param cookie Session cookie header to authenticate with.
 * @returns The router's response.
 */
async function remove(id: string, cookie: string): Promise<Response> {
  return app.request(
    `/api/auth/credentials/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: { Origin: TEST_ORIGIN, Cookie: cookie } },
    ctx.env,
  )
}

describe('passkey list', () => {
  it('flags only the credential that signed the session in', async () => {
    await insertCredential('cred-a', USER, 1)
    await insertCredential('cred-b', USER, 2)
    const cookie = await signIn('cred-a')

    const credentials = await list(cookie)
    expect(credentials.map((c) => [c.id, c.current])).toEqual([
      ['cred-a', true],
      ['cred-b', false],
    ])
  })

  it('flags nothing for a session predating the credential_id column', async () => {
    await insertCredential('cred-a')
    await insertCredential('cred-b')
    const cookie = await signIn()

    expect((await list(cookie)).every((c) => !c.current)).toBe(true)
  })

  it('flags nothing when the session names a credential that was deleted', async () => {
    // The column is deliberately not a foreign key, so a removed passkey leaves
    // a dangling id behind rather than cascading into the session.
    await insertCredential('cred-a')
    await insertCredential('cred-b')
    const cookie = await signIn('cred-b')
    await ctx.db.prepare('DELETE FROM credentials WHERE id = ?').bind('cred-b').run()

    const credentials = await list(cookie)
    expect(credentials.map((c) => c.id)).toEqual(['cred-a'])
    expect(credentials[0].current).toBe(false)
  })

  it('never lists another account credentials', async () => {
    await insertCredential('cred-a')
    await insertCredential('cred-mine', OTHER)
    const cookie = await signIn('cred-a')

    expect((await list(cookie)).map((c) => c.id)).toEqual(['cred-a'])
  })

  it('does not flag another account credential that shares the session id', async () => {
    // Credential ids are authenticator-generated, so two accounts colliding is
    // far-fetched but the flag must still be scoped by owner.
    await insertCredential('cred-a')
    await insertCredential('cred-b')
    const cookie = await signIn('cred-a', OTHER)
    await insertCredential('cred-a2', OTHER)
    await insertCredential('cred-b2', OTHER)

    expect((await list(cookie)).every((c) => !c.current)).toBe(true)
  })
})

describe('passkey removal', () => {
  it('removes a passkey that is not in use', async () => {
    await insertCredential('cred-a')
    await insertCredential('cred-b')
    const cookie = await signIn('cred-a')

    expect((await remove('cred-b', cookie)).status).toBe(200)
    expect((await list(cookie)).map((c) => c.id)).toEqual(['cred-a'])
  })

  it('refuses to remove the passkey that signed the session in', async () => {
    await insertCredential('cred-a')
    await insertCredential('cred-b')
    const cookie = await signIn('cred-a')

    expect((await remove('cred-a', cookie)).status).toBe(403)
    expect((await list(cookie)).map((c) => c.id)).toEqual(['cred-a', 'cred-b'])
  })

  it('lets the in-use passkey go once another session signs in with a different one', async () => {
    await insertCredential('cred-a')
    await insertCredential('cred-b')
    const viaB = await signIn('cred-b')

    expect((await remove('cred-a', viaB)).status).toBe(200)
    expect((await list(viaB)).map((c) => c.id)).toEqual(['cred-b'])
  })

  it('prefers the last-passkey refusal when the only passkey is also in use', async () => {
    // Both rules apply; 409 is the more actionable answer, so it wins.
    await insertCredential('cred-a')
    const cookie = await signIn('cred-a')

    expect((await remove('cred-a', cookie)).status).toBe(409)
  })

  it('still refuses the last passkey when it is not the one in use', async () => {
    await insertCredential('cred-a')
    const cookie = await signIn('cred-other')

    expect((await remove('cred-a', cookie)).status).toBe(409)
  })

  it('blocks nothing extra for a session predating the credential_id column', async () => {
    await insertCredential('cred-a')
    await insertCredential('cred-b')
    const cookie = await signIn()

    expect((await remove('cred-a', cookie)).status).toBe(200)
  })

  it('does not let one account remove another account passkey', async () => {
    await insertCredential('cred-a')
    await insertCredential('cred-b')
    await insertCredential('cred-mine', OTHER)
    const cookie = await signIn('cred-a')

    expect((await remove('cred-mine', cookie)).status).toBe(404)
  })
})
