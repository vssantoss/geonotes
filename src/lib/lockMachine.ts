import {
  ACCURACY_ACCEPTABLE_M,
  ACCURACY_IDEAL_M,
  LOCK_GRACE_MS,
  type GeoFix,
} from './geo'

// Pure state machine for deciding when the GPS fix is good enough to lock.
// Locking kills GPS polling (battery) and unlocks the "+" button.
//
// Rules confirmed with Victor:
//  - accuracy <= 10 m: lock immediately.
//  - accuracy <= 50 m: start a 5 s grace timer; if 10 m is not reached in
//    time, lock with the best fix seen so far.

/** State carried between fixes. */
export interface LockState {
  /** Most accurate fix seen so far (newer fix wins ties). */
  best: GeoFix | null
  /** The fix the machine locked on, or null while acquiring. */
  locked: GeoFix | null
  /** Epoch ms when the grace period expires, or null if not started. */
  graceDeadline: number | null
}

/** The initial (acquiring) state. */
export const INITIAL_LOCK_STATE: LockState = {
  best: null,
  locked: null,
  graceDeadline: null,
}

/**
 * Feeds a new GPS fix into the machine.
 *
 * @param state - current state.
 * @param fix - the new fix.
 * @param now - current epoch ms (injected for testability).
 * @returns the next state; `locked` becomes non-null when the fix is accepted.
 */
export function reduceFix(state: LockState, fix: GeoFix, now: number): LockState {
  if (state.locked) return state

  // Newer fixes win ties so the lock reflects where the user is now.
  const best = !state.best || fix.accuracy <= state.best.accuracy ? fix : state.best

  if (fix.accuracy <= ACCURACY_IDEAL_M) {
    return { best: fix, locked: fix, graceDeadline: null }
  }

  // An acceptable fix arms the grace timer once; it never re-arms so the
  // total wait after reaching 50 m is bounded at 5 s.
  const graceDeadline =
    state.graceDeadline === null && best.accuracy <= ACCURACY_ACCEPTABLE_M
      ? now + LOCK_GRACE_MS
      : state.graceDeadline

  // The deadline may already have passed if fixes arrive sparsely.
  if (graceDeadline !== null && now >= graceDeadline && best.accuracy <= ACCURACY_ACCEPTABLE_M) {
    return { best, locked: best, graceDeadline }
  }

  return { best, locked: null, graceDeadline }
}

/**
 * Handles the grace timer firing.
 *
 * @param state - current state.
 * @returns the next state: locked on the best fix when it is acceptable.
 */
export function reduceGraceExpired(state: LockState): LockState {
  if (state.locked || !state.best) return state
  if (state.best.accuracy <= ACCURACY_ACCEPTABLE_M) {
    return { ...state, locked: state.best }
  }
  return state
}
