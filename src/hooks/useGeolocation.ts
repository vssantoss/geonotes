import { useCallback, useEffect, useRef, useState } from 'react'
import { watchPosition, type GeoFix } from '../lib/geo'
import {
  INITIAL_LOCK_STATE,
  readyFix,
  reduceFix,
  reduceRefineExpired,
  type LockState,
} from '../lib/lockMachine'

/** How long a lock stays reusable; older locks are re-acquired when the main
    screen regains focus. */
const LOCK_REUSE_MS = 10000

/** What the UI needs to render location state. */
export interface GeolocationState {
  /** Latest raw fix, for the live accuracy badge. */
  fix: GeoFix | null
  /** The fix a new note would use: ready (still refining) or locked. */
  location: GeoFix | null
  /** True once refinement finished; GPS is already off at that point. */
  locked: boolean
  /** Permission or availability error, or null. */
  error: 'denied' | 'unavailable' | null
  /** Restarts acquisition after an error or a stale lock. */
  retry: () => void
}

/**
 * Acquires the device location with the rules from lockMachine and kills GPS
 * polling once the refinement window ends. Mount it once in the app shell:
 * the watch then keeps refining while the note editor is open, so a note
 * started during the refinement window sees live location updates.
 *
 * @param active - whether the main screen is the focused screen; controls
 *   the re-acquisition on window focus/visibility with a stale lock.
 * @returns the current geolocation state.
 */
export function useGeolocation(active: boolean): GeolocationState {
  const [state, setState] = useState<LockState>(INITIAL_LOCK_STATE)
  const [fix, setFix] = useState<GeoFix | null>(null)
  const [error, setError] = useState<'denied' | 'unavailable' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef<LockState>(INITIAL_LOCK_STATE)
  // Epoch ms of the current lock, for the staleness check on refocus.
  const lockedAtRef = useRef<number | null>(null)

  const retry = useCallback(() => {
    stateRef.current = INITIAL_LOCK_STATE
    lockedAtRef.current = null
    setState(INITIAL_LOCK_STATE)
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    let refineTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    /** Publishes a machine state; on lock, stops GPS and the timer. */
    const commit = (next: LockState) => {
      stateRef.current = next
      setState(next)
      if (next.locked) {
        lockedAtRef.current = Date.now()
        if (refineTimer) clearTimeout(refineTimer)
        stop()
        stopped = true
      }
    }

    /** (Re)schedules the real-time mirror of the machine's refine deadline. */
    const armTimer = (deadline: number) => {
      if (refineTimer) clearTimeout(refineTimer)
      refineTimer = setTimeout(() => {
        commit(reduceRefineExpired(stateRef.current))
      }, Math.max(0, deadline - Date.now()))
    }

    const stop = watchPosition(
      (newFix) => {
        if (stopped) return
        setFix(newFix)
        setError(null)
        const prev = stateRef.current
        const next = reduceFix(prev, newFix, Date.now())
        // The deadline moved (armed on readiness, or reset by a fix that
        // regressed past 30 m): keep the wall-clock timer in sync.
        if (!next.locked && next.refineDeadline !== null && next.refineDeadline !== prev.refineDeadline) {
          armTimer(next.refineDeadline)
        }
        commit(next)
      },
      (code) => {
        if (stopped) return
        setError(code === 1 ? 'denied' : 'unavailable')
      },
    )

    return () => {
      stopped = true
      stop()
      if (refineTimer) clearTimeout(refineTimer)
    }
    // `attempt` re-runs acquisition on retry() and on stale-lock refocus.
  }, [attempt])

  useEffect(() => {
    if (!active) return

    /** Re-acquires when the main screen surfaces with a lock past its
        reuse window; a running acquisition is left alone. */
    const maybeRestart = () => {
      if (document.visibilityState !== 'visible') return
      const lockedAt = lockedAtRef.current
      if (lockedAt !== null && Date.now() - lockedAt > LOCK_REUSE_MS) retry()
    }

    // Becoming active (e.g. returning from the editor) counts as focus.
    maybeRestart()
    window.addEventListener('focus', maybeRestart)
    document.addEventListener('visibilitychange', maybeRestart)
    return () => {
      window.removeEventListener('focus', maybeRestart)
      document.removeEventListener('visibilitychange', maybeRestart)
    }
  }, [active, retry])

  return { fix, location: readyFix(state), locked: state.locked !== null, error, retry }
}
