import { useCallback, useEffect, useRef, useState } from 'react'
import { ACQUIRE_TIMEOUT_MS, watchPosition, type GeoFix } from '../lib/geo'
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
  /** Permission, availability or acquisition-timeout error, or null.
      'timeout' means no <= 30 m fix arrived within the acquisition window. */
  error: 'denied' | 'unavailable' | 'timeout' | null
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
  const [error, setError] = useState<'denied' | 'unavailable' | 'timeout' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef<LockState>(INITIAL_LOCK_STATE)
  // Epoch ms of the current lock, for the staleness check on refocus.
  const lockedAtRef = useRef<number | null>(null)
  // True after acquisition gave up (timeout); drives re-acquire on refocus.
  const timedOutRef = useRef(false)

  const retry = useCallback(() => {
    stateRef.current = INITIAL_LOCK_STATE
    lockedAtRef.current = null
    timedOutRef.current = false
    setState(INITIAL_LOCK_STATE)
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    let refineTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    /** Publishes a machine state; on lock, stops GPS and the timers. */
    const commit = (next: LockState) => {
      stateRef.current = next
      setState(next)
      if (next.locked) {
        lockedAtRef.current = Date.now()
        finish()
      }
    }

    /** Stops the watch and clears both timers; the acquisition is over. */
    const finish = () => {
      if (refineTimer) clearTimeout(refineTimer)
      clearTimeout(acquireTimer)
      stop()
      stopped = true
    }

    /** (Re)schedules the real-time mirror of the machine's refine deadline. */
    const armTimer = (deadline: number) => {
      if (refineTimer) clearTimeout(refineTimer)
      refineTimer = setTimeout(() => {
        commit(reduceRefineExpired(stateRef.current))
      }, Math.max(0, deadline - Date.now()))
    }

    // Give up if no ready (<= 30 m) fix arrives in time: stop GPS and report a
    // timeout so the + button stays disabled until the user retries. Reaching
    // readiness clears this timer, so refinement is never cut short.
    const acquireTimer = setTimeout(() => {
      if (stopped || readyFix(stateRef.current)) return
      timedOutRef.current = true
      finish()
      setError('timeout')
    }, ACQUIRE_TIMEOUT_MS)

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
        // A ready fix means acquisition succeeded; the refine window (or an
        // immediate lock) takes over from the acquisition timeout.
        if (readyFix(next)) clearTimeout(acquireTimer)
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
      clearTimeout(acquireTimer)
    }
    // `attempt` re-runs acquisition on retry() and on stale-lock refocus.
  }, [attempt])

  useEffect(() => {
    if (!active) return

    /** Re-acquires when the main screen surfaces with a lock past its reuse
        window, or after acquisition timed out; a running acquisition is left
        alone. */
    const maybeRestart = () => {
      if (document.visibilityState !== 'visible') return
      const lockedAt = lockedAtRef.current
      const staleLock = lockedAt !== null && Date.now() - lockedAt > LOCK_REUSE_MS
      if (staleLock || timedOutRef.current) retry()
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
