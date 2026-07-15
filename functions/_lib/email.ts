import type { Env } from './env'

/** The address sign-in codes are sent from. Must be on a Resend-verified domain. */
const MAIL_FROM = 'GeoNotes <gnotes@vshub.app>'
/** Resend's REST endpoint for sending a single e-mail. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

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

/** Local sender used when the dev response echoes the code to the UI. */
class DevEmailSender implements EmailSender {
  /**
   * Accepts the dev-only delivery without logging the address or code.
   *
   * @param to - recipient e-mail address.
   * @param code - the 6-digit code.
   */
  async sendCode(_to: string, _code: string): Promise<void> {}
}

/** Sends sign-in codes through Resend's REST API. */
class ResendEmailSender implements EmailSender {
  /**
   * @param apiKey - Resend API key with sending permission.
   */
  constructor(private readonly apiKey: string) {}

  /**
   * E-mails a sign-in code via Resend, sending both HTML and plain-text bodies
   * (the text part improves deliverability and covers text-only clients).
   *
   * @param to - recipient e-mail address.
   * @param code - the 6-digit code.
   * @throws Error when Resend rejects the request.
   */
  async sendCode(to: string, code: string): Promise<void> {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to,
        subject: `${code} is your GeoNotes sign-in code`,
        text: codeText(code),
        html: codeHtml(code),
      }),
    })
    if (!res.ok) {
      // Provider response bodies may repeat the recipient, so do not log them.
      throw new Error(`Resend send failed (${res.status})`)
    }
  }
}

/**
 * Picks the e-mail sender implementation for the current environment.
 * Uses Resend when an API key is configured. Development may use the no-op
 * sender because the route echoes the code, while production fails closed.
 *
 * @param env - function environment.
 * @returns the sender.
 */
export function getEmailSender(env: Env): EmailSender {
  if (env.RESEND_API_KEY) return new ResendEmailSender(env.RESEND_API_KEY)
  if (env.ENVIRONMENT === 'dev') return new DevEmailSender()
  throw new Error('RESEND_API_KEY is required outside development')
}

/**
 * Builds the plain-text body for a sign-in code e-mail.
 *
 * @param code - the 6-digit code.
 * @returns the text body.
 */
function codeText(code: string): string {
  return `Your GeoNotes sign-in code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this e-mail.`
}

/**
 * Builds the HTML body for a sign-in code e-mail.
 *
 * @param code - the 6-digit code.
 * @returns the HTML body.
 */
function codeHtml(code: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111">
  <p style="margin:0 0 16px">Your GeoNotes sign-in code is:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${code}</p>
  <p style="margin:0;color:#555;font-size:14px">It expires in 10 minutes. If you did not request it, you can ignore this e-mail.</p>
</div>`
}
