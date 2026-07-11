import type { Env } from './env'

/** Delivers sign-in codes. Swap the implementation to wire a real provider. */
export interface EmailSender {
  /**
   * Sends a sign-in code to an address.
   *
   * @param to - recipient e-mail address.
   * @param code - the 6-digit code.
   */
  sendCode(to: string, code: string): Promise<void>
}

/** Stub sender: logs the code. Replace with Resend/Brevo/etc. later by
    returning a real implementation from getEmailSender. */
class DevEmailSender implements EmailSender {
  /**
   * Logs the code to the Function's console instead of sending e-mail.
   *
   * @param to - recipient e-mail address.
   * @param code - the 6-digit code.
   */
  async sendCode(to: string, code: string): Promise<void> {
    console.log(`[email stub] sign-in code for ${to}: ${code}`)
  }
}

/**
 * Picks the e-mail sender implementation for the current environment.
 *
 * @param _env - function environment (unused until a real provider exists).
 * @returns the sender.
 */
export function getEmailSender(_env: Env): EmailSender {
  return new DevEmailSender()
}
