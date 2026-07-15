import { describe, expect, it } from 'vitest'
import { buildSessionCookie, readSessionCookie } from './session'

describe('session cookies', () => {
  it('creates a short-lived HttpOnly host cookie', () => {
    const cookie = buildSessionCookie('opaque-token', 604800)

    expect(cookie).toContain('__Host-geonotes_session=opaque-token')
    expect(cookie).toContain('Max-Age=604800')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('reads the session cookie without using an authorization header', () => {
    const request = new Request('https://gnotes.vshub.app/api/sync', {
      headers: { Cookie: '__Host-geonotes_session=opaque-token' },
    })

    expect(readSessionCookie(request)).toBe('opaque-token')
  })

  it('builds a secure cookie deletion', () => {
    expect(buildSessionCookie('', 0)).toContain('Max-Age=0')
  })
})
