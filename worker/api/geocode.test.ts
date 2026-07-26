import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from '../router'
import type { Env } from '../_lib/env'

/**
 * The reverse-geocode proxy, and specifically the one distinction the client
 * depends on: coordinates that have no address must answer differently from a
 * geocoder that could not be asked.
 *
 * Getting this wrong is silent and permanent. If an outage came back as
 * `address: null` the client would file it as "nowhere" and stop retrying, and
 * a note written during that outage would keep its bare coordinates for good.
 * If a genuine blank came back as an error, open ocean would be re-requested on
 * every sync forever.
 */

const ORIGIN = 'https://gnotes.vshub.app'

/** A Nominatim reply for somewhere it knows. */
const KNOWN = { address: { road: 'Rua das Flores', house_number: '12', suburb: 'Centro' } }
/** What Nominatim answers out at sea: HTTP 200, no address, no display_name. */
const NOWHERE = { error: 'Unable to geocode' }

/**
 * Builds an env for the router. The geocode route reads no binding, but the
 * router's origin check needs ORIGIN present.
 *
 * @returns an Env whose unused bindings are inert.
 */
function fakeEnv(): Env {
  return {
    DB: null as unknown as D1Database,
    ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
    ENVIRONMENT: 'dev',
    RP_ID: 'gnotes.vshub.app',
    ORIGIN,
    AUTH_SECRET: 'test-secret',
  }
}

/**
 * Installs an in-memory stand-in for the edge cache.
 *
 * @returns the backing store, so a test can assert what was and was not cached.
 */
function stubCache(): Map<string, Response> {
  const store = new Map<string, Response>()
  vi.stubGlobal('caches', {
    default: {
      match: (key: string) => Promise.resolve(store.get(key)?.clone()),
      put: (key: string, res: Response) => {
        store.set(key, res)
        return Promise.resolve()
      },
    },
  })
  return store
}

/**
 * Stubs the upstream Nominatim call.
 *
 * @param res - the response it should answer with.
 * @returns the mock, for call-count assertions.
 */
function stubUpstream(res: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(res))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Drives the route through the router.
 *
 * @param lat/lng - coordinates to resolve; vary them to avoid cache collisions.
 * @returns the response.
 */
async function get(lat: number, lng: number): Promise<Response> {
  return app.request(`/api/geocode?lat=${lat}&lng=${lng}`, {}, fakeEnv())
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('geocode proxy', () => {
  it('returns a short address when the geocoder knows the place', async () => {
    stubCache()
    stubUpstream(Response.json(KNOWN))

    const res = await get(-23.5, -46.6)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ address: 'Rua das Flores 12, Centro' })
  })

  it('answers 200 with a null address where the geocoder knows nothing', async () => {
    // The definitive "there is nothing here", which the client records so it
    // never asks about these coordinates again.
    stubCache()
    stubUpstream(Response.json(NOWHERE))

    const res = await get(-30.1, -40.2)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ address: null })
  })

  it('caches that blank answer, since it will not change soon', async () => {
    const store = stubCache()
    const upstream = stubUpstream(Response.json(NOWHERE))

    await get(-30.3, -40.4)
    expect(store.size).toBe(1)
    expect(upstream).toHaveBeenCalledTimes(1)

    // A second request for the same spot is served from the cache.
    await get(-30.3, -40.4)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('fails with 502 when the geocoder cannot be asked', async () => {
    stubCache()
    stubUpstream(new Response('rate limited', { status: 429 }))

    const res = await get(-31.1, -41.1)
    expect(res.status).toBe(502)
  })

  it('never caches an upstream failure as an answer', async () => {
    // Caching it would turn a passing outage into a month of wrong answers for
    // every note at those coordinates.
    const store = stubCache()
    stubUpstream(new Response('boom', { status: 503 }))

    await get(-32.2, -42.2)
    expect(store.size).toBe(0)
  })

  it('still rejects impossible coordinates before reaching upstream', async () => {
    stubCache()
    const upstream = stubUpstream(Response.json(KNOWN))

    const res = await get(999, 0)
    expect(res.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
})
