import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimEmailCodeAttempt,
  claimEmailCodeRequest,
  consumeEmailCode,
  issueEmailCode,
  pruneExpiredEmailCodes,
} from '../worker/_lib/email-code'
import { sha256Hex } from '../worker/_lib/crypto'
import { createTestDb, type TestDb } from './support/d1'

/**
 * E-mail sign-in code abuse controls, against real SQLite.
 *
 * Each of these functions is a single statement carrying all of its logic in an
 * ON CONFLICT / CASE / WHERE clause, deliberately, so that two concurrent
 * requests cannot both pass a check. That means the SQL *is* the abuse control,
 * and there is nothing left to test in TypeScript once you stub the database
 * out. Every limit below is checked by driving the real statements.
 *
 * The limits themselves are module-private constants in email-code.ts, so they
 * are restated here as literals; a test failing after a deliberate limit change
 * is the intended signal.
 */

const EMAIL = 'someone@example.com'
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

let ctx: TestDb

beforeEach(async () => {
  ctx = await createTestDb()
})

afterEach(async () => {
  await ctx.dispose()
})

describe('per-address request window', () => {
  it('allows five requests in a window and refuses the sixth', async () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      expect(await claimEmailCodeRequest(ctx.env, EMAIL, now + i)).toBe(true)
    }

    expect(await claimEmailCodeRequest(ctx.env, EMAIL, now + 5)).toBe(false)
  })

  it('starts a fresh window once the old one has lapsed', async () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) await claimEmailCodeRequest(ctx.env, EMAIL, now + i)

    // A fixed window, not a sliding one: past the hour the counter resets
    // outright rather than ageing out one request at a time.
    expect(await claimEmailCodeRequest(ctx.env, EMAIL, now + HOUR + 1)).toBe(true)

    const row = await ctx.db
      .prepare('SELECT requests FROM email_code_rate_limits WHERE email = ?')
      .bind(EMAIL)
      .first<{ requests: number }>()
    expect(row?.requests).toBe(1)
  })

  it('counts each address separately', async () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) await claimEmailCodeRequest(ctx.env, EMAIL, now + i)

    expect(await claimEmailCodeRequest(ctx.env, 'other@example.com', now)).toBe(true)
  })

  it('does not advance the counter on a refused request', async () => {
    // A refused request must not extend the window, or a bot hammering the
    // endpoint would keep a legitimate user locked out indefinitely.
    const now = Date.now()
    for (let i = 0; i < 5; i++) await claimEmailCodeRequest(ctx.env, EMAIL, now + i)
    await claimEmailCodeRequest(ctx.env, EMAIL, now + 10)

    const row = await ctx.db
      .prepare('SELECT window_started_at, requests FROM email_code_rate_limits WHERE email = ?')
      .bind(EMAIL)
      .first<{ window_started_at: number; requests: number }>()
    expect(row).toMatchObject({ window_started_at: now, requests: 5 })
  })
})

describe('code issuing cooldown', () => {
  it('issues a code for an address with none outstanding', async () => {
    const code = await issueEmailCode(ctx.env, EMAIL, Date.now())

    expect(code).toMatch(/^\d{6}$/)
  })

  it('refuses to reissue within the cooldown', async () => {
    const now = Date.now()
    await issueEmailCode(ctx.env, EMAIL, now)

    // Resending immediately would let one request cause many e-mails, and would
    // also reset the attempt counter, undoing the guessing limit below.
    expect(await issueEmailCode(ctx.env, EMAIL, now + 30 * 1000)).toBeNull()
  })

  it('reissues once the cooldown has elapsed', async () => {
    const now = Date.now()
    await issueEmailCode(ctx.env, EMAIL, now)

    expect(await issueEmailCode(ctx.env, EMAIL, now + MINUTE + 1)).not.toBeNull()
  })

  it('resets the attempt counter when it does reissue', async () => {
    const now = Date.now()
    await issueEmailCode(ctx.env, EMAIL, now)
    await claimEmailCodeAttempt(ctx.env, EMAIL, now)
    await claimEmailCodeAttempt(ctx.env, EMAIL, now)

    await issueEmailCode(ctx.env, EMAIL, now + MINUTE + 1)

    const row = await ctx.db
      .prepare('SELECT attempts FROM email_codes WHERE email = ?')
      .bind(EMAIL)
      .first<{ attempts: number }>()
    expect(row?.attempts).toBe(0)
  })

  it('stores only the hash of the code', async () => {
    const now = Date.now()
    const code = await issueEmailCode(ctx.env, EMAIL, now)

    const row = await ctx.db
      .prepare('SELECT code_hash FROM email_codes WHERE email = ?')
      .bind(EMAIL)
      .first<{ code_hash: string }>()
    expect(row?.code_hash).not.toContain(code as string)
    // The address is part of the hashed material, so a hash lifted from one
    // account's row cannot be replayed against another.
    expect(row?.code_hash).toBe(await sha256Hex(`${code}:${EMAIL}`))
  })
})

describe('verification attempts', () => {
  it('allows five guesses and burns the code on the sixth', async () => {
    const now = Date.now()
    await issueEmailCode(ctx.env, EMAIL, now)

    for (let i = 0; i < 5; i++) {
      expect(await claimEmailCodeAttempt(ctx.env, EMAIL, now)).not.toBeNull()
    }
    // A six-digit code is only 10^6 wide, so an unbounded attempt count would be
    // brute-forceable in minutes.
    expect(await claimEmailCodeAttempt(ctx.env, EMAIL, now)).toBeNull()
  })

  it('refuses an attempt against an expired code', async () => {
    const now = Date.now()
    await issueEmailCode(ctx.env, EMAIL, now)

    expect(await claimEmailCodeAttempt(ctx.env, EMAIL, now + 11 * MINUTE)).toBeNull()
  })

  it('refuses an attempt for an address with no code', async () => {
    expect(await claimEmailCodeAttempt(ctx.env, EMAIL, Date.now())).toBeNull()
  })
})

describe('consuming a code', () => {
  it('succeeds exactly once for the same code', async () => {
    const now = Date.now()
    const code = await issueEmailCode(ctx.env, EMAIL, now)
    const hash = await sha256Hex(`${code}:${EMAIL}`)

    expect(await consumeEmailCode(ctx.env, EMAIL, hash)).toBe(true)
    // The second caller of a captured (email, code) pair must lose the race:
    // the row is already gone, so no session can be minted twice from one code.
    expect(await consumeEmailCode(ctx.env, EMAIL, hash)).toBe(false)
  })

  it('refuses a hash that does not match the stored one', async () => {
    await issueEmailCode(ctx.env, EMAIL, Date.now())

    expect(await consumeEmailCode(ctx.env, EMAIL, await sha256Hex('000000:wrong'))).toBe(false)
  })
})

describe('pruning', () => {
  it('removes expired codes and lapsed windows but keeps live ones', async () => {
    const now = Date.now()
    await issueEmailCode(ctx.env, 'stale@example.com', now - 2 * HOUR)
    await claimEmailCodeRequest(ctx.env, 'stale@example.com', now - 2 * HOUR)
    await issueEmailCode(ctx.env, 'fresh@example.com', now)
    await claimEmailCodeRequest(ctx.env, 'fresh@example.com', now)

    await pruneExpiredEmailCodes(ctx.env, now)

    const codes = await ctx.db.prepare('SELECT email FROM email_codes').all<{ email: string }>()
    const windows = await ctx.db
      .prepare('SELECT email FROM email_code_rate_limits')
      .all<{ email: string }>()
    expect(codes.results.map((r) => r.email)).toEqual(['fresh@example.com'])
    expect(windows.results.map((r) => r.email)).toEqual(['fresh@example.com'])
  })
})
