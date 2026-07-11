import { KV, kvGet, kvSet } from './db'

// Empty in web builds (same-origin). Set VITE_API_URL when packaging with
// Capacitor, where the app is served from capacitor://localhost.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

/** Error thrown for non-2xx API responses, carrying the HTTP status. */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Fetch wrapper for the GeoNotes API: prefixes the base URL, sends JSON and
 * attaches the bearer session token when one is stored.
 *
 * @param path - API path starting with /api/.
 * @param body - optional JSON body; its presence makes the request a POST.
 * @param method - explicit HTTP method override (e.g. 'DELETE').
 * @returns the parsed JSON response.
 * @throws ApiError on non-2xx responses (status 401 means the session is invalid).
 */
export async function apiFetch<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const token = await kvGet(KV.sessionToken)
  const res = await fetch(API_BASE + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    throw new ApiError(res.status, await res.text().catch(() => res.statusText))
  }
  return (await res.json()) as T
}

/**
 * Stores or clears the bearer session token used by apiFetch.
 *
 * @param token - the token to store, or null to sign out locally.
 */
export async function setSessionToken(token: string | null): Promise<void> {
  await kvSet(KV.sessionToken, token)
}

/**
 * Resolves coordinates to a human-readable address via the server-side
 * Nominatim proxy.
 *
 * @returns the address string, or null when unresolvable or offline.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const out = await apiFetch<{ address: string | null }>(
      `/api/geocode?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`,
    )
    return out.address
  } catch {
    // Geocoding is best-effort: the note is saved without an address and
    // backfilled during a later sync.
    return null
  }
}
