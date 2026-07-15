import { describe, expect, it, vi } from 'vitest'
import { getEmailSender } from './email'
import type { Env } from './env'

describe('getEmailSender', () => {
  it('fails closed outside development when no provider is configured', () => {
    const env = { ENVIRONMENT: 'production' } as Env
    expect(() => getEmailSender(env)).toThrow('RESEND_API_KEY is required')
  })

  it('does not log the recipient or code in development', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const env = { ENVIRONMENT: 'dev' } as Env

    await getEmailSender(env).sendCode('private@example.com', '123456')

    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
