import { describe, expect, it } from 'vitest'
import { INITIAL_LOCK_STATE, reduceFix, reduceGraceExpired } from '../lockMachine'
import { LOCK_GRACE_MS, type GeoFix } from '../geo'

/** Builds a fix with the given accuracy. */
function fix(accuracy: number, timestamp = 0): GeoFix {
  return { lat: 40.0, lng: -8.0, accuracy, timestamp }
}

describe('lock machine', () => {
  it('locks immediately at ideal accuracy (<= 10 m)', () => {
    const s = reduceFix(INITIAL_LOCK_STATE, fix(8), 1000)
    expect(s.locked).toEqual(fix(8))
  })

  it('does not lock on a coarse fix (> 50 m)', () => {
    const s = reduceFix(INITIAL_LOCK_STATE, fix(80), 1000)
    expect(s.locked).toBeNull()
    expect(s.graceDeadline).toBeNull()
  })

  it('arms the 5 s grace timer once an acceptable fix (<= 50 m) arrives', () => {
    const s = reduceFix(INITIAL_LOCK_STATE, fix(30), 1000)
    expect(s.locked).toBeNull()
    expect(s.graceDeadline).toBe(1000 + LOCK_GRACE_MS)
  })

  it('locks with the best fix when the grace timer expires', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(40), 1000)
    s = reduceFix(s, fix(25), 2000)
    s = reduceGraceExpired(s)
    expect(s.locked).toEqual(fix(25))
  })

  it('does not re-arm the grace timer on later acceptable fixes', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(45), 1000)
    s = reduceFix(s, fix(35), 3000)
    expect(s.graceDeadline).toBe(1000 + LOCK_GRACE_MS)
  })

  it('ideal fix during the grace period locks without waiting', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(30), 1000)
    s = reduceFix(s, fix(9), 2000)
    expect(s.locked).toEqual(fix(9))
  })

  it('locks via deadline check when fixes arrive after the deadline passed', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(30), 1000)
    s = reduceFix(s, fix(28), 1000 + LOCK_GRACE_MS + 500)
    expect(s.locked).toEqual(fix(28))
  })

  it('keeps the newer fix on an accuracy tie so the lock is fresh', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(30, 1), 1000)
    s = reduceFix(s, fix(30, 2), 2000)
    expect(s.best).toEqual(fix(30, 2))
  })

  it('grace expiry without any acceptable fix stays unlocked', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(120), 1000)
    s = reduceGraceExpired(s)
    expect(s.locked).toBeNull()
  })

  it('is inert once locked', () => {
    let s = reduceFix(INITIAL_LOCK_STATE, fix(5), 1000)
    const locked = s.locked
    s = reduceFix(s, fix(3), 2000)
    expect(s.locked).toBe(locked)
  })
})
