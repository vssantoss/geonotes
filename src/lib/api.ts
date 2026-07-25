import { getSessionToken } from './native-session'

// Empty in web builds so requests stay same-origin and the session cookie is
// attached. The native (Capacitor) build sets VITE_API_URL to the deployed
// origin (see `build:native`) because its webview runs from `https://localhost`
// and must reach the API cross-origin. Cross-origin means the cookie will not
// ride along, so the native build sends the session token as a bearer instead
// (see the Authorization header below); this constant only fixes where the
// request is sent.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

/**
 * Opens the connection to the API host at app start, before anything needs it.
 *
 * Native builds reach the API cross-origin, so the first request pays DNS, TCP
 * and TLS in full. Measured on the dev emulator that was 1554ms for the
 * preflight of the first call, against 20-70ms for the same call once the
 * connection was up, and nothing touches the network between app start and the
 * user tapping sign in, so all of it landed on that tap. A preconnect moves it
 * off the critical path.
 *
 * No-op on web, where API_BASE is empty, requests are same-origin and the
 * connection that loaded the page is already open.
 */
export function preconnectApi(): void {
  if (!API_BASE) return
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = API_BASE
  // apiFetch sends credentials: 'same-origin', which cross-origin means no
  // credentials, so warm the anonymous socket pool: the one fetch will reuse.
  link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
}

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
  // Native builds carry the session as a bearer token; on web this is always
  // null and the request authenticates by the same-origin cookie instead.
  const token = await getSessionToken()
  const res = await fetch(API_BASE + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
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
