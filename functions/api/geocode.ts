import { json, HttpError, route } from '../_lib/http'
import type { Env } from '../_lib/env'

// Reverse-geocoding proxy for Nominatim (OpenStreetMap).
// Proxying keeps the strict usage policy manageable: a proper User-Agent and
// results cached at the edge. The endpoint is public because signing in is
// optional and local-only users still get addresses; the coordinate-rounded
// cache keeps upstream traffic within Nominatim's 1 req/s policy.
// The UI shows the required "© OpenStreetMap contributors" attribution.

/** Cached addresses stay valid this long (addresses rarely change). */
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * GET /api/geocode?lat=..&lng=..: resolves coordinates to a short
 * human-readable address via Nominatim.
 */
export const onRequestGet = route<Env>(async ({ request }) => {
  const url = new URL(request.url)
  const lat = Number(url.searchParams.get('lat'))
  const lng = Number(url.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'bad coordinates')
  }

  // ~11 m rounding: nearby requests share a cache entry, which both cuts
  // latency and respects Nominatim's 1 req/s policy.
  const key = `https://geonotes-geocode.internal/${lat.toFixed(4)},${lng.toFixed(4)}`
  const cache = caches.default
  const cached = await cache.match(key)
  if (cached) return cached

  const upstream = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18` +
      `&accept-language=${encodeURIComponent(request.headers.get('Accept-Language') ?? 'en')}`,
    { headers: { 'User-Agent': 'GeoNotes/0.1 (contact: victor@victorsantos.org)' } },
  )
  if (!upstream.ok) return json({ address: null })

  const data = (await upstream.json()) as {
    address?: Record<string, string>
    display_name?: string
  }
  const res = json({ address: shortAddress(data) })
  res.headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
  await cache.put(key, res.clone())
  return res
})

/**
 * Builds a short address ("street number, locality") from a Nominatim
 * response, falling back to the full display name.
 *
 * @param data - Nominatim jsonv2 payload.
 * @returns a compact address or null when nothing usable came back.
 */
function shortAddress(data: { address?: Record<string, string>; display_name?: string }): string | null {
  const a = data.address
  if (a) {
    const street = [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(' ')
    const locality = a.neighbourhood ?? a.suburb ?? a.village ?? a.town ?? a.city
    const parts = [street, locality].filter(Boolean)
    if (parts.length > 0) return parts.join(', ')
  }
  return data.display_name?.slice(0, 120) ?? null
}
