import { afterEach, describe, expect, it, vi } from 'vitest'
import { reverseGeocode } from '../api'

/**
 * How the client reads the geocode proxy's answers.
 *
 * The three outcomes drive different behaviour in the sync engine's backfill:
 * `resolved` writes the address and queues it for upload, `nowhere` is recorded
 * so the coordinates are never asked about again, and `unavailable` leaves the
 * note untouched to be retried. Collapsing the last two, as a bare `string |
 * null` return did, is what left notes written offline showing coordinates
 * forever.
 */

vi.mock('../native-session', () => ({
  getSessionToken: () => Promise.resolve(null),
}))

/**
 * Stubs the network with a single canned response.
 *
 * @param res - what fetch should resolve with, or an error to reject with.
 */
function stubFetch(res: Response | Error): void {
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res))),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reverseGeocode', () => {
  it('reports an address the geocoder knows', async () => {
    stubFetch(Response.json({ address: 'Rua das Flores 12, Centro' }))

    expect(await reverseGeocode(-23.5, -46.6)).toEqual({
      status: 'resolved',
      address: 'Rua das Flores 12, Centro',
    })
  })

  it('reads a null address as a final answer, not a failure', async () => {
    // Only reachable on a 200, which the proxy sends only after Nominatim
    // itself has answered.
    stubFetch(Response.json({ address: null }))

    expect(await reverseGeocode(-30.1, -40.2)).toEqual({ status: 'nowhere' })
  })

  it('reads the proxy 502 as unavailable, so it will be retried', async () => {
    stubFetch(new Response('geocoder unavailable', { status: 502 }))

    expect(await reverseGeocode(-31.1, -41.1)).toEqual({ status: 'unavailable' })
  })

  it('reads a dead connection as unavailable too', async () => {
    stubFetch(new TypeError('Failed to fetch'))

    expect(await reverseGeocode(-32.2, -42.2)).toEqual({ status: 'unavailable' })
  })
})
