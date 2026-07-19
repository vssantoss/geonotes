import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { consumeChallenge, createChallenge, PASSKEY_LOGIN_SUBJECT } from '../worker/_lib/challenge'
import { HttpError } from '../worker/_lib/http'
import { createTestDb, type TestDb } from './support/d1'

/**
 * WebAuthn challenge store, against real SQLite.
 *
 * The replay defence is entirely in one statement: consumeChallenge deletes and
 * reads the row together, so a captured (token, passkey response) pair can never
 * be used twice. That property only exists if the SQL actually behaves that way,
 * which a stubbed database cannot show.
 */

const SUBJECT = 'user-a'
const CHALLENGE = 'Y2hhbGxlbmdl'

let ctx: TestDb

beforeEach(async () => {
  ctx = await createTestDb()
})

afterEach(async () => {
  await ctx.dispose()
})

/**
 * Asserts that a promise rejects with a specific HttpError status and message.
 *
 * @param promise The call under test.
 * @param status Expected HTTP status.
 * @param message Expected error message.
 * @returns Nothing.
 */
async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  message: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, message })
  await expect(promise).rejects.toBeInstanceOf(HttpError)
}

describe('challenge lifecycle', () => {
  it('returns the stored challenge for the subject it was issued to', async () => {
    const token = await createChallenge(ctx.env, CHALLENGE, SUBJECT)

    expect(await consumeChallenge(ctx.env, token, SUBJECT)).toBe(CHALLENGE)
  })

  it('issues an opaque token that is not the challenge itself', async () => {
    const token = await createChallenge(ctx.env, CHALLENGE, SUBJECT)

    expect(token).not.toBe(CHALLENGE)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('issues a distinct token per ceremony', async () => {
    const first = await createChallenge(ctx.env, CHALLENGE, SUBJECT)
    const second = await createChallenge(ctx.env, CHALLENGE, SUBJECT)

    expect(first).not.toBe(second)
  })

  it('cannot be consumed twice', async () => {
    // The whole point of the store: an attacker who captures a token and the
    // passkey response cannot replay them, because the first verification
    // already deleted the row.
    const token = await createChallenge(ctx.env, CHALLENGE, SUBJECT)
    await consumeChallenge(ctx.env, token, SUBJECT)

    await expectHttpError(consumeChallenge(ctx.env, token, SUBJECT), 401, 'bad challenge token')
  })

  it('rejects an unknown token', async () => {
    await expectHttpError(consumeChallenge(ctx.env, 'not-a-token', SUBJECT), 401, 'bad challenge token')
  })
})

describe('challenge binding', () => {
  it('rejects a token presented for a different subject', async () => {
    // Without the subject check, a challenge issued for a registration ceremony
    // could be redeemed as a login for another account.
    const token = await createChallenge(ctx.env, CHALLENGE, SUBJECT)

    await expectHttpError(consumeChallenge(ctx.env, token, 'user-b'), 401, 'challenge expired')
  })

  it('does not accept a login challenge as a user-scoped one', async () => {
    const token = await createChallenge(ctx.env, CHALLENGE, PASSKEY_LOGIN_SUBJECT)

    await expectHttpError(consumeChallenge(ctx.env, token, SUBJECT), 401, 'challenge expired')
  })

  it('consumes the row even when the subject is wrong', async () => {
    // The DELETE..RETURNING fires before the subject is examined, so a wrong
    // guess burns the ceremony rather than leaving it available to retry.
    const token = await createChallenge(ctx.env, CHALLENGE, SUBJECT)
    await consumeChallenge(ctx.env, token, 'user-b').catch(() => {})

    await expectHttpError(consumeChallenge(ctx.env, token, SUBJECT), 401, 'bad challenge token')
  })
})

describe('challenge expiry', () => {
  it('rejects a challenge past its five-minute lifetime', async () => {
    const token = await createChallenge(ctx.env, CHALLENGE, SUBJECT)
    // Backdate the row rather than wait: the TTL is a module-private constant.
    await ctx.db
      .prepare('UPDATE webauthn_challenges SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, token)
      .run()

    await expectHttpError(consumeChallenge(ctx.env, token, SUBJECT), 401, 'challenge expired')
  })

  it('sweeps expired ceremonies when a new one is created', async () => {
    // Nothing else deletes unfinished ceremonies (a user who abandons a prompt
    // never comes back), so without this sweep the table only ever grows.
    const abandoned = await createChallenge(ctx.env, CHALLENGE, SUBJECT)
    await ctx.db
      .prepare('UPDATE webauthn_challenges SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, abandoned)
      .run()

    await createChallenge(ctx.env, CHALLENGE, 'user-b')

    const row = await ctx.db
      .prepare('SELECT id FROM webauthn_challenges WHERE id = ?')
      .bind(abandoned)
      .first()
    expect(row).toBeNull()
  })
})
