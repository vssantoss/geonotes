import { useCallback, useEffect, useRef, useState } from 'react'
import { watchPosition, LOCK_GRACE_MS, type GeoFix } from '../lib/geo'
import {
  INITIAL_LOCK_STATE,
  reduceFix,
  reduceGraceExpired,
  type LockState,
} from '../lib/lockMachine'

/** How long a lock stays reusable after GPS was killed, so returning from the
    editor does not force a full re-acquisition. */
const LOCK_REUSE_MS = 60000

// Module-level cache: survives MainScreen unmount/remount (editor round trips).
let cachedLock: { fix: GeoFix; at: number } | null = null

/** What the UI needs to render location state. */
export interface GeolocationState {
  /** Latest raw fix, for the live accuracy badge. */
  fix: GeoFix | null
  /** The locked fix once acquired; GPS is already off at that point. */
  locked: GeoFix | null
  /** Permission or availability error, or null. */
  error: 'denied' | 'unavailable' | null
  /** Restarts acquisition after an error or a stale lock. */
  retry: () => void
}

/**
 * Acquires the device location with the lock rules from lockMachine and
 * kills GPS polling the moment a fix is accepted.
 *
 * @returns the current geolocation state for the main screen.
 */
export function useGeolocation(): GeolocationState {
  const [fix, setFix] = useState<GeoFix | null>(cachedLock?.fix ?? null)
  const [locked, setLocked] = useState<GeoFix | null>(
    cachedLock && Date.now() - cachedLock.at < LOCK_REUSE_MS ? cachedLock.fix : null,
  )
  const [error, setError] = useState<'denied' | 'unavailable' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef<LockState>(INITIAL_LOCK_STATE)

  const retry = useCallback(() => {
    cachedLock = null
    setLocked(null)
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    // A fresh cached lock means GPS was already acquired and killed; do not
    // restart polling just because the screen remounted.
    if (locked) return

    stateRef.current = INITIAL_LOCK_STATE
    let graceTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    /** Accepts a lock: records it, stops GPS and cancels the grace timer. */
    const accept = (accepted: GeoFix) => {
      cachedLock = { fix: accepted, at: Date.now() }
      setLocked(accepted)
      if (graceTimer) clearTimeout(graceTimer)
      stop()
      stopped = true
    }

    const stop = watchPosition(
      (newFix) => {
        if (stopped) return
        setFix(newFix)
        setError(null)
        const prev = stateRef.current
        const next = reduceFix(prev, newFix, Date.now())
        stateRef.current = next
        if (next.locked) {
          accept(next.locked)
          return
        }
        // The machine armed the grace timer on this fix: mirror it in real time.
        if (next.graceDeadline !== null && prev.graceDeadline === null) {
          graceTimer = setTimeout(() => {
            const after = reduceGraceExpired(stateRef.current)
            stateRef.current = after
            if (after.locked) accept(after.locked)
          }, LOCK_GRACE_MS)
        }
      },
      (code) => {
        if (stopped) return
        setError(code === 1 ? 'denied' : 'unavailable')
      },
    )

    return () => {
      stopped = true
      stop()
      if (graceTimer) clearTimeout(graceTimer)
    }
    // `attempt` re-runs acquisition on retry(); `locked` stops it once accepted.
  }, [attempt, locked])

  return { fix, locked, error, retry }
}
