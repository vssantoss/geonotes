// Geolocation adapter and geometry helpers.
// All browser geolocation access goes through this module so it can later be
// swapped for @capacitor/geolocation without touching the rest of the app.

/** A GPS fix in the shape the app uses everywhere. */
export interface GeoFix {
  lat: number
  lng: number
  /** Reported accuracy radius in meters. */
  accuracy: number
  /** Epoch ms when the fix was obtained. */
  timestamp: number
}

/** Accuracy (m) at which the fix locks immediately. */
export const ACCURACY_IDEAL_M = 10
/** Accuracy (m) considered acceptable after the grace period. */
export const ACCURACY_ACCEPTABLE_M = 50
/** How long (ms) to keep trying for an ideal fix once an acceptable one exists. */
export const LOCK_GRACE_MS = 5000
/** Minimum radius (m) within which a note counts as "at your location". */
export const NEARBY_MIN_RADIUS_M = 25

/**
 * Starts a high-accuracy position watch.
 *
 * @param onFix - called for every position update.
 * @param onError - called with the GeolocationPositionError code on failure.
 * @returns a function that stops the watch (used to kill GPS and save battery).
 */
export function watchPosition(
  onFix: (fix: GeoFix) => void,
  onError: (code: number) => void,
): () => void {
  if (!('geolocation' in navigator)) {
    onError(2) // POSITION_UNAVAILABLE
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (pos) =>
      onFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp,
      }),
    (err) => onError(err.code),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}

/**
 * Great-circle distance between two coordinates using the haversine formula.
 *
 * @returns distance in meters.
 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000 // mean Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Radius (m) within which notes count as "here" for a given fix.
 * Grows with fix accuracy so a coarse fix still surfaces the right notes.
 *
 * @param accuracy - the fix accuracy in meters.
 * @returns the effective nearby radius in meters.
 */
export function nearbyRadiusMeters(accuracy: number): number {
  return Math.max(NEARBY_MIN_RADIUS_M, accuracy)
}

/**
 * Formats a distance for display, switching to km past 1000 m.
 *
 * @returns e.g. "12 m" or "3.4 km".
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}
