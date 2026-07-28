import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/router'
import { sha256Hex } from '../worker/_lib/crypto'
import { createTestDb, insertUser, TEST_ORIGIN, type TestDb } from './support/d1'
import { installTimingSafeEqual } from './support/timing-safe-equal'
import type { Env } from '../worker/_lib/env'

/**
 * The Google Play review sign-in shortcut (Env.REVIEW_EMAIL), against real
 * SQLite.
 *
 * Reviewers may not create their own accounts and cannot read our mailbox, so
 * one configured address takes a fixed code instead of an e-mailed one. What
 * matters is that the shortcut reaches all the way to an enroll token, that it
 * cannot be locked out by the abuse controls it deliberately skips, and above
 * all that it stays confined to that single address. Those are properties of
 * the real code rows and the real rate-limit statements, so a fake DB.prepare
 * could not tell whether any of them hold.
 */

const REVIEW_EMAIL = 'review@example.com'
const REVIEW_CODE = '123456'
const OTHER_EMAIL = 'someone@example.com'

let ctx: TestDb

// email-verify compares the code hash with workerd's timing-safe primitive,
// which Node does not provide.
beforeAll(installTimingSafeEqual)

beforeEach(async () => {
  ctx = await createTestDb()
  // The reviewer recovers a pre-made account rather than creating one, which is
  // the whole reason the shortcut exists.
  await insertUser(ctx.db, 'review-user', REVIEW_EMAIL)
})

afterEach(async () => {
  await ctx.dispose()
})

/**
 * Builds an Env with the review shortcut configured.
 *
 * @param overrides - shortcut fields to replace, for the misconfiguration cases.
 * @returns the test Env plus REVIEW_EMAIL and REVIEW_CODE.
 */
function envWithReview(overrides: Partial<Env> = {}): Env {
  return { ...ctx.env, REVIEW_EMAIL, REVIEW_CODE, ...overrides }
}

/**
 * Posts to an auth endpoint with the origin the CSRF check requires.
 *
 * @param path - endpoint path under /api/auth.
 * @param body - JSON request body.
 * @param env - environment to run the request against.
 * @returns the response.
 */
async function post(path: string, body: unknown, env: Env): Promise<Response> {
  return await app.request(
    `/api/auth/${path}`,
    {
      method: 'POST',
      headers: { Origin: TEST_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  )
}

/**
 * Reads the stored code row for an address.
 *
 * @param email - address to look up.
 * @returns the row, or null when no code is outstanding.
 */
function storedCode(email: string) {
  return ctx.db
    .prepare('SELECT code_hash, attempts FROM email_codes WHERE email = ?')
    .bind(email)
    .first<{ code_hash: string; attempts: number }>()
}

describe('the review address', () => {
  it('accepts the fixed code without an e-mail being sent', async () => {
    const res = await post('email-request', { email: REVIEW_EMAIL, mode: 'recover' }, envWithReview())

    expect(res.status).toBe(200)
    // Identical to an ordinary recover reply. In particular no devCode, which
    // the dev create path would echo, so nothing distinguishes the shortcut
    // from outside.
    expect(await res.json()).toEqual({ sent: true })
    expect((await storedCode(REVIEW_EMAIL))?.code_hash).toBe(
      await sha256Hex(`${REVIEW_CODE}:${REVIEW_EMAIL}`),
    )
  })

  it('carries the fixed code all the way to an enroll token', async () => {
    await post('email-request', { email: REVIEW_EMAIL, mode: 'recover' }, envWithReview())

    const res = await post(
      'email-verify',
      { email: REVIEW_EMAIL, code: REVIEW_CODE },
      envWithReview(),
    )

    expect(res.status).toBe(200)
    // The token authorizing passkey enrolment: the reviewer's last blocker
    // before the Credential Manager sheet.
    const body = (await res.json()) as { enrollToken?: string }
    expect(body.enrollToken).toEqual(expect.any(String))
  })

  it('still rejects a code that is not the configured one', async () => {
    await post('email-request', { email: REVIEW_EMAIL, mode: 'recover' }, envWithReview())

    const res = await post('email-verify', { email: REVIEW_EMAIL, code: '000000' }, envWithReview())

    expect(res.status).toBe(401)
  })

  it('can request repeatedly without hitting the resend cooldown', async () => {
    // A reviewer retrying must never lock themselves out of the one account
    // they were given, so the shortcut runs ahead of both abuse controls.
    for (let i = 0; i < 8; i++) {
      const res = await post(
        'email-request',
        { email: REVIEW_EMAIL, mode: 'recover' },
        envWithReview(),
      )
      expect(res.status).toBe(200)
    }

    const res = await post(
      'email-verify',
      { email: REVIEW_EMAIL, code: REVIEW_CODE },
      envWithReview(),
    )
    expect(res.status).toBe(200)
  })

  it('resets spent guesses on the next request', async () => {
    await post('email-request', { email: REVIEW_EMAIL, mode: 'recover' }, envWithReview())
    for (let i = 0; i < 5; i++) {
      await post('email-verify', { email: REVIEW_EMAIL, code: '000000' }, envWithReview())
    }
    // The code is burned after five guesses, which a reviewer could reach by
    // mistyping. Re-requesting has to clear it rather than leave them stuck.
    expect((await storedCode(REVIEW_EMAIL))?.attempts).toBe(5)

    await post('email-request', { email: REVIEW_EMAIL, mode: 'recover' }, envWithReview())

    const res = await post(
      'email-verify',
      { email: REVIEW_EMAIL, code: REVIEW_CODE },
      envWithReview(),
    )
    expect(res.status).toBe(200)
  })

  it('matches the configured address case-insensitively', async () => {
    const res = await post(
      'email-request',
      { email: 'ReView@Example.COM', mode: 'recover' },
      envWithReview({ REVIEW_EMAIL: 'Review@Example.com' }),
    )

    expect(res.status).toBe(200)
    expect((await storedCode(REVIEW_EMAIL))?.code_hash).toBe(
      await sha256Hex(`${REVIEW_CODE}:${REVIEW_EMAIL}`),
    )
  })
})

describe('confinement to that one address', () => {
  it('leaves every other address on the ordinary path', async () => {
    const res = await post('email-request', { email: OTHER_EMAIL, mode: 'create' }, envWithReview())

    // The dev echo proves a real random code was issued and mailed rather than
    // the fixed one being handed out.
    const body = (await res.json()) as { devCode?: string }
    expect(body.devCode).toMatch(/^\d{6}$/)
    expect(body.devCode).not.toBe(REVIEW_CODE)
  })

  it('does not let another address be verified with the fixed code', async () => {
    await post('email-request', { email: OTHER_EMAIL, mode: 'create' }, envWithReview())

    const res = await post('email-verify', { email: OTHER_EMAIL, code: REVIEW_CODE }, envWithReview())

    expect(res.status).toBe(401)
  })

  it('is inert when REVIEW_EMAIL is unset', async () => {
    // The state the Worker ships in before a submission and returns to after
    // review: the address is just an address again.
    const res = await post('email-request', { email: REVIEW_EMAIL, mode: 'create' }, ctx.env)

    const body = (await res.json()) as { devCode?: string }
    expect(body.devCode).toMatch(/^\d{6}$/)
    expect(body.devCode).not.toBe(REVIEW_CODE)
  })
})

describe('misconfiguration', () => {
  it('fails loudly for the review address when REVIEW_CODE is missing', async () => {
    // Falling through to the normal path would mail a code to an address nobody
    // reads, and the reviewer would have no way to tell why they were stuck.
    const res = await post(
      'email-request',
      { email: REVIEW_EMAIL, mode: 'recover' },
      envWithReview({ REVIEW_CODE: undefined }),
    )

    expect(res.status).toBe(500)
  })

  it('fails loudly when REVIEW_CODE is not six digits', async () => {
    // email-verify rejects anything but six digits before it reaches the stored
    // hash, so such a code could never be entered.
    const res = await post(
      'email-request',
      { email: REVIEW_EMAIL, mode: 'recover' },
      envWithReview({ REVIEW_CODE: 'letmein' }),
    )

    expect(res.status).toBe(500)
  })

  it('leaves other addresses working while it is misconfigured', async () => {
    const res = await post(
      'email-request',
      { email: OTHER_EMAIL, mode: 'create' },
      envWithReview({ REVIEW_CODE: 'letmein' }),
    )

    expect(res.status).toBe(200)
  })
})
