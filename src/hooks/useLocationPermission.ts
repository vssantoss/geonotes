import { useCallback, useEffect, useRef, useState } from 'react'
import {
  checkLocationPermission,
  explanationFor,
  requestLocationPermission,
  type ExplainablePermission,
  type LocationPermission,
} from '../lib/location-permission'

/** What the shell needs to gate the app on location access. */
export interface LocationPermissionState {
  /** Current permission, or null while the first check is in flight. */
  permission: LocationPermission | null
  /** The state to explain right now, or null when no dialog is wanted. */
  explaining: ExplainablePermission | null
  /** Raises the system prompt; resolves true when precise location was granted. */
  request: () => Promise<boolean>
  /** Closes the dialog for this app run without granting. */
  dismiss: () => void
  /** Re-reads the permission and lets the dialog appear again. */
  reopen: () => void
}

/**
 * Tracks the location permission and decides whether to explain why the app
 * needs it. GeoNotes cannot create a note without a fix, so a missing
 * permission is worth interrupting for, but never twice with the same message:
 * once a message has been shown and answered, only a different one gets
 * through. Nothing is persisted across runs, since a user who reopens the app
 * is asking to use it again.
 *
 * @returns the permission state and the actions the dialog drives.
 */
export function useLocationPermission(): LocationPermissionState {
  const [permission, setPermission] = useState<LocationPermission | null>(null)
  // What the dialog last said, so the same message is not repeated. Keyed on
  // the explanation rather than the permission: `coarse` and `coarseBlocked`
  // are two different things to say about one permission, and dismissing the
  // first must not swallow the second.
  const [dismissedFor, setDismissedFor] = useState<ExplainablePermission | null>(null)
  // Whether the precise-location upgrade has been asked for, which is the only
  // way to find out whether Android still offers it. See explanationFor.
  const [upgradeAsked, setUpgradeAsked] = useState(false)
  // Guards the async check against a unmount and against an in-flight check
  // landing after a newer one (foreground re-checks can overlap a slow first read).
  const runRef = useRef(0)

  /** Publishes a permission, forgetting a spent upgrade offer once it no
      longer applies (a grant, or a revoke back to nothing, starts over). */
  const publish = useCallback((result: LocationPermission) => {
    setPermission(result)
    if (result !== 'coarse') setUpgradeAsked(false)
  }, [])

  /** Re-reads the current permission and publishes it. */
  const refresh = useCallback(async () => {
    const run = ++runRef.current
    const result = await checkLocationPermission()
    if (run === runRef.current) publish(result)
  }, [publish])

  useEffect(() => {
    void refresh()
    return () => {
      // Invalidate any in-flight check so it cannot set state after unmount.
      runRef.current++
    }
  }, [refresh])

  useEffect(() => {
    /**
     * Re-reads the permission when the app returns to the foreground. Leaving
     * for the system settings is the only way out of `blocked`, and coming back
     * is the only signal the app gets that it happened; without this the user
     * would have to restart the app to be believed.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const explanation = explanationFor(permission, upgradeAsked)

  const request = useCallback(async () => {
    // The question the user is about to answer. Only that one is settled by the
    // prompt, so only that one gets suppressed: an outcome the user has not
    // been told about yet still deserves its dialog. A single refusal keeps the
    // state at `askable` and so stays quiet, which is what stops this nagging.
    const answered = explanation
    // Asking from `coarse` is the upgrade request, and asking is the only way
    // to discover whether Android still offers it. Record it before the await:
    // if the permission comes back `coarse` again the offer was already spent,
    // and that is what turns the dialog into the settings route.
    if (permission === 'coarse') setUpgradeAsked(true)
    const result = await requestLocationPermission()
    // Invalidate any check still in flight, which would otherwise overwrite a
    // fresher answer with a staler one.
    runRef.current++
    publish(result)
    setDismissedFor(answered)
    return result === 'granted'
  }, [explanation, permission, publish])

  const dismiss = useCallback(() => setDismissedFor(explanation), [explanation])

  const reopen = useCallback(() => {
    setDismissedFor(null)
    void refresh()
  }, [refresh])

  return {
    permission,
    // Suppress only the message already shown. `coarse` and `coarseBlocked`
    // share a permission but are different things to say, so answering or
    // closing the first still lets the second through.
    explaining: explanation !== null && explanation !== dismissedFor ? explanation : null,
    request,
    dismiss,
    reopen,
  }
}
