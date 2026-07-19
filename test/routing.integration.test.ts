import { unstable_startWorker } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration tests for the parts of the request path that live in
 * wrangler.toml rather than in code: the static-assets router, `run_worker_first`,
 * and `not_found_handling`.
 *
 * router.test.ts drives the Hono app directly, so it cannot see any of this. On
 * Workers a request matching a real file in dist/ is answered by the asset
 * server without the Worker running at all, which is exactly how the
 * non-production "GeoNotes Dev" renaming was silently disabled during the Pages
 * migration while every unit test passed.
 *
 * `unstable_startWorker` boots the same local stack as `wrangler dev` from the
 * real wrangler.toml, so the asset router is in front of the Worker here. That
 * is the whole point: the config is the thing under test.
 *
 * These read the built output, so dist/ must be current. Run `pnpm build` first.
 */

const BASE = 'https://integration.test'

/** The local dev worker under test, started once for the whole file. */
let worker: Awaited<ReturnType<typeof unstable_startWorker>>

beforeAll(async () => {
  // A missing dist/ fails here, in the wrangler startup, rather than as a
  // confusing 404 in every assertion.
  // port 0 takes an ephemeral port, so this never collides with the :8788
  // staging server or with GeoNotesGPT on :8791.
  worker = await unstable_startWorker({
    config: './wrangler.toml',
    dev: { inspector: false, server: { port: 0 } },
  })
}, 60_000)

afterAll(async () => {
  await worker?.dispose()
})

/**
 * Fetches a path through the full local stack (asset router in front of the Worker).
 *
 * `init` is typed off `worker.fetch` rather than the global `RequestInit`,
 * because this file is typechecked with @cloudflare/workers-types while wrangler's
 * dev API is typed against undici, and the two `RequestInit`s are not assignable.
 * @param path Request path, including any query string.
 * @param init Optional fetch options.
 * @returns The response from the local worker.
 */
function get(path: string, init?: Parameters<typeof worker.fetch>[1]) {
  return worker.fetch(`${BASE}${path}`, init)
}

describe('assets router configuration', () => {
  it('runs the Worker for files that exist, so the manifest is rewritten', async () => {
    // The regression guard. dist/manifest.webmanifest on disk says "GeoNotes";
    // only serveSite turns it into "GeoNotes Dev" off production. If
    // run_worker_first stops covering this path the asset server answers
    // directly and the rewrite silently disappears.
    const res = await get('/manifest.webmanifest')
    expect(res.status).toBe(200)
    const manifest = (await res.json()) as { name: string }
    expect(manifest.name).toBe('GeoNotes Dev')
  })

  it('runs the Worker for the index document', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>GeoNotes Dev</title>')
  })

  it('falls back to the SPA shell for a deep link', async () => {
    const res = await get('/notes/some-id', { headers: { 'Sec-Fetch-Mode': 'navigate' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('serves hashed assets with their real content type', async () => {
    // Guards the other side of run_worker_first: a rule broad enough to swallow
    // /assets/* would route every script through the Worker, and a rule that
    // also lost the asset exclusion would break caching for no benefit.
    const html = await (await get('/')).text()
    const script = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0]
    expect(script, 'index.html should reference a hashed script').toBeTruthy()

    const res = await get(script as string)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
  })

  it('does not answer an unknown API path with the SPA shell', async () => {
    // This failure is silent: SPA fallback returns index.html with a 200, so the
    // client throws on JSON.parse instead of seeing a clean 404. It happened
    // once already, when run_worker_first was written as an allowlist that did
    // not include /api/*.
    const res = await get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  it('reaches the Worker for API requests rather than the asset server', async () => {
    // The security headers are set in json()/error(), which every route returns
    // through, so their presence proves the response came from Worker code.
    const res = await get('/api/sync', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('applies the _headers CSP to the served document', async () => {
    const res = await get('/')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
  })
})
