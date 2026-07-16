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

/** Accuracy (m) at which the fix is good enough to add a note. */
export const ACCURACY_READY_M = 30
/** Accuracy (m) treated as the best GPS hardware delivers; refining further
    is pointless, so such a fix locks immediately. */
export const ACCURACY_BEST_M = 5
/** How long (ms) to keep refining after a ready fix before locking. */
export const REFINE_MS = 10000
/** How long (ms) to try for a ready (<= 30 m) fix before giving up. GPS is
    then stopped and adding a note stays disabled until the user retries. */
export const ACQUIRE_TIMEOUT_MS = 60000
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

/** Meters per foot, for imperial conversion. */
const FEET_PER_METER = 3.28084
/** Feet per mile. */
const FEET_PER_MILE = 5280

/** A distance unit system: feet/miles or meters/kilometers. */
export type UnitSystem = 'imperial' | 'metric'

/**
 * The default unit system for a locale, used when the user has not overridden
 * it. Per product spec English and Spanish default to imperial; Portuguese
 * defaults to metric.
 *
 * @param locale - the active UI locale ('en' | 'es' | 'pt').
 * @returns 'imperial' for English/Spanish, 'metric' for Portuguese.
 */
export function localeUnits(locale: string): UnitSystem {
  return locale === 'pt' ? 'metric' : 'imperial'
}

/**
 * Formats a distance for display in the given unit system: feet then miles for
 * imperial, meters then kilometers for metric. The unit follows the chosen
 * system rather than the value so a list of notes stays in one system.
 *
 * @param meters - the distance in meters.
 * @param units - the unit system to render in.
 * @returns e.g. "98 ft" / "1.3 mi" (imperial) or "12 m" / "3.4 km" (metric).
 */
export function formatDistance(meters: number, units: UnitSystem): string {
  if (units === 'imperial') {
    const feet = meters * FEET_PER_METER
    if (feet < FEET_PER_MILE) return `${Math.round(feet)} ft`
    return `${(feet / FEET_PER_MILE).toFixed(1)} mi`
  }
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}
