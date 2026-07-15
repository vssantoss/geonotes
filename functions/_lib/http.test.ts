import { describe, expect, it } from 'vitest'
import { hasTrustedOrigin } from './http'

describe('hasTrustedOrigin', () => {
  const expected = 'https://gnotes.vshub.app'

  it('accepts the configured origin', () => {
    const request = new Request(`${expected}/api/sync`, { headers: { Origin: expected } })
    expect(hasTrustedOrigin(request, expected)).toBe(true)
  })

  it('rejects missing and cross-origin headers', () => {
    const missing = new Request(`${expected}/api/sync`)
    const crossOrigin = new Request(`${expected}/api/sync`, {
      headers: { Origin: 'https://attacker.example' },
    })
    expect(hasTrustedOrigin(missing, expected)).toBe(false)
    expect(hasTrustedOrigin(crossOrigin, expected)).toBe(false)
  })
})
