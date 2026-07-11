import { ACCURACY_BEST_M, ACCURACY_READY_M, REFINE_MS, type GeoFix } from './geo'

// Pure state machine for deciding when the GPS fix is good enough to lock.
// Locking kills GPS polling (battery); readiness unlocks the "+" button.
//
// Rules confirmed with Victor:
//  - accuracy <= 30 m: the fix is ready (notes can be added) and a 10 s
//    refinement window starts to squeeze out a better fix.
//  - a fix worse than 30 m during that window resets the 10 s timer.
//  - accuracy <= 5 m: GPS cannot realistically do better, so lock right
//    away instead of sitting out the rest of the window.
//  - when the timer expires, lock with the best fix seen so far.

/** State carried between fixes. */
export interface LockState {
  /** Most accurate fix seen so far (newer fix wins ties). */
  best: GeoFix | null
  /** The fix the machine locked on, or null while acquiring/refining. */
  locked: GeoFix | null
  /** Epoch ms when the refinement window expires, or null before readiness. */
  refineDeadline: number | null
}

/** The initial (acquiring) state. */
export const INITIAL_LOCK_STATE: LockState = {
  best: null,
  locked: null,
  refineDeadline: null,
}

/**
 * The fix a new note would use right now: the locked fix, or the best fix
 * once it is accurate enough to be ready.
 *
 * @param state - current state.
 * @returns the usable fix, or null while still acquiring.
 */
export function readyFix(state: LockState): GeoFix | null {
  if (state.locked) return state.locked
  return state.best && state.best.accuracy <= ACCURACY_READY_M ? state.best : null
}

/**
 * Feeds a new GPS fix into the machine.
 *
 * @param state - current state.
 * @param fix - the new fix.
 * @param now - current epoch ms (injected for testability).
 * @returns the next state; `locked` becomes non-null when refinement ends
 *   or a fix at the accuracy floor makes further refinement pointless.
 */
export function reduceFix(state: LockState, fix: GeoFix, now: number): LockState {
  if (state.locked) return state

  // Newer fixes win ties so the lock reflects where the user is now.
  const best = !state.best || fix.accuracy <= state.best.accuracy ? fix : state.best

  // Maximum accuracy achieved: waiting out the refinement window gains nothing.
  if (best.accuracy <= ACCURACY_BEST_M) {
    return { best, locked: best, refineDeadline: state.refineDeadline }
  }

  // Not ready yet: no fix has reached the 30 m threshold.
  if (best.accuracy > ACCURACY_READY_M) {
    return { best, locked: null, refineDeadline: null }
  }

  // The deadline may already have passed if fixes arrive sparsely and the
  // real-time timer did not fire; lock before considering a reset.
  if (state.refineDeadline !== null && now >= state.refineDeadline) {
    return { best, locked: best, refineDeadline: state.refineDeadline }
  }

  // Arm the refinement window on the first ready fix; a fix that regresses
  // past the threshold resets it so the lock waits for the signal to settle.
  const refineDeadline =
    state.refineDeadline === null || fix.accuracy > ACCURACY_READY_M
      ? now + REFINE_MS
      : state.refineDeadline

  return { best, locked: null, refineDeadline }
}

/**
 * Handles the refinement timer firing.
 *
 * @param state - current state.
 * @returns the next state: locked on the best fix when one is ready.
 */
export function reduceRefineExpired(state: LockState): LockState {
  if (state.locked || !state.best) return state
  if (state.best.accuracy <= ACCURACY_READY_M) {
    return { ...state, locked: state.best }
  }
  return state
}
