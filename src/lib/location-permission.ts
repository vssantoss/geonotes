import { Capacitor } from '@capacitor/core'
import { Geolocation, type PermissionStatus } from '@capacitor/geolocation'

/**
 * Whether the app may use location, and if not, what would actually help.
 *
 * The app never starts a position watch while this is anything but `granted`
 * or `browser`. On Android the WebView raises the system permission prompt by
 * itself the first time the page touches `navigator.geolocation` (see
 * `BridgeWebChromeClient.onGeolocationPermissionsShowPrompt`), so a watch
 * started before the question is settled asks the user cold, on top of the
 * app's own explanation.
 *
 * - `granted`  precise location is held; the watch can run.
 * - `coarse`   only approximate location was allowed. Android hands the page a
 *              fix anyway, but at kilometre scale, so it can never reach the
 *              30 m bar a note needs and would just fail after the acquisition
 *              timeout.
 * - `askable`  requesting will raise the real system prompt.
 * - `blocked`  denied for good; only the system settings can undo it.
 * - `browser`  the engine will not say in advance (Safari, or no Permissions
 *              API). Not a claim that location is allowed: browsers do have a
 *              real geolocation permission and the user can refuse it. It means
 *              the browser owns the prompt and raises it inline on first use,
 *              so there is nothing for the app to stage beforehand.
 */
export type LocationPermission = 'granted' | 'coarse' | 'askable' | 'blocked' | 'browser'

/**
 * What the app has something to say about. Mostly the permissions themselves,
 * plus `coarseBlocked`: approximate location where asking for the upgrade has
 * already been tried and changed nothing. That is not a permission Android
 * reports, it is something the app can only learn by trying (see
 * explanationFor), so it exists here and not in LocationPermission.
 */
export type ExplainablePermission = 'askable' | 'coarse' | 'coarseBlocked' | 'blocked'

/**
 * Whether a permission lets the app start acquiring a position. `browser` counts
 * because there the first geolocation call is itself the request.
 *
 * @param permission - the permission to test, or null while the check is in flight.
 * @returns true when a watch may start.
 */
export function canWatch(permission: LocationPermission | null): boolean {
  return permission === 'granted' || permission === 'browser'
}

/**
 * Which state the app would explain, before accounting for what the user has
 * already dismissed.
 *
 * Whether Android will still offer to upgrade approximate location to precise
 * cannot be read anywhere. Keeping "Approximate" at the upgrade prompt sets
 * USER_FIXED on the fine permission, after which requesting draws nothing, but
 * that flag is invisible from JavaScript, and Capacitor's own state is no help:
 * it caches fine as `denied` from the very first Approximate grant, because it
 * derives that from shouldShowRequestPermissionRationale, which Android returns
 * false for in the upgrade case even while the upgrade is still on offer.
 *
 * So the app finds out the only way it can, by asking once. Until then the
 * offer is assumed live and the button is shown; if asking leaves the
 * permission where it was, that is the answer, and the dialog switches to the
 * settings route rather than keep a button that does nothing.
 *
 * @param permission - the current permission, or null while the check runs.
 * @param upgradeAsked - whether the precise upgrade has already been requested.
 * @returns the state to explain, or null when there is nothing to say.
 */
export function explanationFor(
  permission: LocationPermission | null,
  upgradeAsked: boolean,
): ExplainablePermission | null {
  if (permission === 'coarse') return upgradeAsked ? 'coarseBlocked' : 'coarse'
  if (permission === 'askable' || permission === 'blocked') return permission
  return null
}

/**
 * Folds a Capacitor permission status into the app's states.
 *
 * The `location` alias covers ACCESS_FINE_LOCATION and ACCESS_COARSE_LOCATION,
 * and Capacitor reports an alias granted only when every permission behind it
 * is ("multiple permissions with the same alias must all be true, otherwise all
 * false", Bridge.getPermissionStates). So a user who picked "Approximate" at
 * the Android 12+ prompt shows up as location not granted but coarseLocation
 * granted, which is the only way to tell that case from a plain refusal.
 *
 * `prompt` (never asked) and `prompt-with-rationale` (refused once, Android is
 * willing to ask again) fold together: both mean asking still raises a real
 * dialog, and this app explains itself either way.
 *
 * That fold is only trustworthy once approximate location has been ruled out.
 * With coarse granted, Capacitor reports the fine permission as `denied` from
 * the first Approximate choice onwards, whether or not the upgrade is still on
 * offer, so coarseLocation is checked first and the fine state is not consulted.
 *
 * @param status - the status returned by checkPermissions or requestPermissions.
 * @returns the matching app-level permission.
 */
function toPermission(status: PermissionStatus): LocationPermission {
  if (status.location === 'granted') return 'granted'
  if (status.coarseLocation === 'granted') return 'coarse'
  if (status.location === 'prompt' || status.location === 'prompt-with-rationale') return 'askable'
  return 'blocked'
}

/**
 * Reads the browser's geolocation permission without prompting.
 *
 * @returns `granted`, `askable` or `blocked` where the engine reports them, and
 *   `browser` where it will not: Safari rejects `geolocation` as a permission
 *   name, and older engines have no Permissions API at all.
 */
async function checkWebPermission(): Promise<LocationPermission> {
  if (!navigator.permissions) return 'browser'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    if (status.state === 'granted') return 'granted'
    return status.state === 'denied' ? 'blocked' : 'askable'
  } catch {
    return 'browser'
  }
}

/**
 * Raises the browser's own permission prompt and reports the outcome.
 *
 * Browsers expose no explicit request call: the prompt is a side effect of the
 * first geolocation access, so one throwaway fix request is the ask. Its result
 * is deliberately ignored and the stored permission re-read instead, because
 * the two are not the same question. A dismissed prompt (Escape, or the X) is
 * not a refusal, and a fix that simply could not be obtained is the watch's
 * problem to report, not evidence the user said no.
 *
 * @returns the permission after the prompt settles.
 */
async function requestWebPermission(): Promise<LocationPermission> {
  if (!('geolocation' in navigator)) return 'blocked'
  await new Promise<void>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(),
      () => resolve(),
      // Only the verdict matters here, so keep it cheap: a cached position of
      // any age answers it without powering up the GPS. The real watch does the
      // high-accuracy work afterwards.
      { enableHighAccuracy: false, maximumAge: Infinity, timeout: 30000 },
    )
  })
  return checkWebPermission()
}

/**
 * Reads the current location permission without prompting.
 *
 * @returns the current permission.
 */
export async function checkLocationPermission(): Promise<LocationPermission> {
  if (!Capacitor.isNativePlatform()) return checkWebPermission()
  try {
    return toPermission(await Geolocation.checkPermissions())
  } catch {
    // A plugin that cannot answer is treated as askable: the request is the
    // thing that decides, and a failed check must not lock the user out of
    // ever being asked.
    return 'askable'
  }
}

/**
 * Raises the system permission prompt and reports what the user chose.
 * Pointless once the permission is `blocked`, so callers should send the user
 * to the system settings in that case instead.
 *
 * @returns the permission after the prompt settles.
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  if (!Capacitor.isNativePlatform()) return requestWebPermission()
  try {
    return toPermission(await Geolocation.requestPermissions({ permissions: ['location'] }))
  } catch {
    return 'blocked'
  }
}
