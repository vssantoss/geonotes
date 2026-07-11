import { describe, expect, it } from 'vitest'
import {
  INITIAL_LOCK_STATE,
  readyFix,
  reduceFix,
  reduceRefineExpired,
} from '../lockMachine'
import { REFINE_MS, type GeoFix } from '../geo'

/** Builds a fix with the given accuracy. */
function fix(accuracy: number, timestamp = 0): GeoFix {
  return { lat: 40.0, lng: -8.0, accuracy, timestamp }
}

describe('lock machine', () => {
  it('is not ready and arms nothing on a coarse fix (> 30 m)', () => {
    const s = reduceFix(INITIAL_LOCK_STATE, fix(80), 1000)
    expect(s.locked).toBeNull()
    expect(s.refineDeadline).toBeNull()
    expect(readyFix(s)).toBeNull()
  })

  it('becomes ready and arms the 10 s refinement window at <= 30 m', () => {
    const s = reduceFix(INITIAL_LOCK_STATE, fix(30), 1000)
    expect(s.locked).toBeNull()
    expect(s.refineDeadline).toBe(1000 + REFINE_MS)
    expect(readyFix(s)).toEqual(fix(30))
  })

  it('does not lock immediately on an accurate fix above the floor', () => {
    const s = reduceFix(INITIAL_LOCK_STATE, fix(12), 1000)
    expect(s.locked).toBeNull()
    expect(s.refineDeadline).toBe(1000 + REFINE_MS)
  })

  it('locks immediately at the accuracy floor (<= 5 m)', () => {
    const s = reduceFix(INITIAL_LOCK_STATE, fix(4), 1000)
    expect(s.locked).toEqual(fix(4))
  })

  it('a floor fix during the refinement window ends it early', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(25), 1000)
    s = reduceFix(s, fix(5), 3000)
    expect(s.locked).toEqual(fix(5))
  })

  it('locks with the best fix when the refinement window expires', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(25), 1000)
    s = reduceFix(s, fix(12), 2000)
    s = reduceRefineExpired(s)
    expect(s.locked).toEqual(fix(12))
  })

  it('keeps the deadline on later fixes that stay within 30 m', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(28), 1000)
    s = reduceFix(s, fix(20), 3000)
    expect(s.refineDeadline).toBe(1000 + REFINE_MS)
  })

  it('resets the deadline when a fix regresses past 30 m', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(25), 1000)
    s = reduceFix(s, fix(60), 4000)
    expect(s.refineDeadline).toBe(4000 + REFINE_MS)
    // Still ready: the best fix within 30 m is kept.
    expect(readyFix(s)).toEqual(fix(25))
    expect(s.locked).toBeNull()
  })

  it('locks via deadline check when fixes arrive after the deadline passed', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(25), 1000)
    s = reduceFix(s, fix(22), 1000 + REFINE_MS + 500)
    expect(s.locked).toEqual(fix(22))
  })

  it('keeps the newer fix on an accuracy tie so the lock is fresh', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(30, 1), 1000)
    s = reduceFix(s, fix(30, 2), 2000)
    expect(s.best).toEqual(fix(30, 2))
  })

  it('refine expiry without any ready fix stays unlocked', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(120), 1000)
    s = reduceRefineExpired(s)
    expect(s.locked).toBeNull()
  })

  it('is inert once locked', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(25), 1000)
    s = reduceRefineExpired(s)
    const locked = s.locked
    s = reduceFix(s, fix(3), 20000)
    expect(s.locked).toBe(locked)
  })

  it('readyFix returns the locked fix after locking', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(25), 1000)
    s = reduceRefineExpired(s)
    expect(readyFix(s)).toEqual(fix(25))
  })
})
