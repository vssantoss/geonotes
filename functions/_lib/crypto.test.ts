import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { timingSafeEqual } from './crypto'

const platformComparison = vi.fn((left: ArrayBufferView, right: ArrayBufferView) => {
  if (left.byteLength !== right.byteLength) throw new TypeError('length mismatch')
  const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength)
  const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength)
  let difference = 0
  for (let index = 0; index < leftBytes.length; index++) {
    difference |= leftBytes[index] ^ rightBytes[index]
  }
  return difference === 0
})

describe('timingSafeEqual', () => {
  beforeAll(() => {
    Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
      configurable: true,
      value: platformComparison,
    })
  })

  afterAll(() => {
    Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual')
  })

  it('uses the platform primitive for matching-length values', () => {
    expect(timingSafeEqual('same', 'same')).toBe(true)
    expect(timingSafeEqual('left', 'right')).toBe(false)
    expect(platformComparison).toHaveBeenCalled()
  })

  it('still compares when lengths differ and always rejects', () => {
    expect(timingSafeEqual('short', 'much-longer')).toBe(false)
    const [left, right] = platformComparison.mock.lastCall ?? []
    expect(left).toBe(right)
  })
})
