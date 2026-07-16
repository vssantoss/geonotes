import type { Env } from './env'

/** The address confirmation codes are sent from. Must be on a Resend-verified domain. */
const MAIL_FROM = 'GeoNotes <gnotes@vshub.app>'
/** Resend's REST endpoint for sending a single e-mail. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'
/** Hosted app icon used as the email logo (data URIs are blocked by most clients). */
const LOGO_URL = 'https://gnotes.vshub.app/pwa-192x192.png'
/** Brand red, taken from the app icon (favicon.svg). */
const BRAND_RED = '#b91c1c'

/** Delivers sign-in codes. Swap the implementation to wire a real provider. */
export interface EmailSender {
  /**
   * Sends an e-mail confirmation code to an address.
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
   * E-mails a confirmation code via Resend, sending both HTML and plain-text
   * bodies (the text part improves deliverability and covers text-only clients).
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
        subject: `${code} is your GeoNotes confirmation code`,
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
 * Builds the plain-text body for a confirmation-code e-mail.
 *
 * @param code - the 6-digit code.
 * @returns the text body.
 */
function codeText(code: string): string {
  return `Your GeoNotes confirmation code is ${code}. Enter it to confirm your e-mail address. It expires in 10 minutes. If you did not request it, you can safely ignore this e-mail.`
}

/**
 * Builds the HTML body for a confirmation-code e-mail.
 *
 * Table-based with inline styles so it renders consistently across e-mail
 * clients (including Outlook), and pulls the logo from a hosted URL because
 * most clients block data-URI images.
 *
 * @param code - the 6-digit code.
 * @returns the HTML body.
 */
function codeHtml(code: string): string {
  const font = "font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#ffffff;${font}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;width:100%;background:#f4f4f5;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">
          <tr>
            <td align="center" style="padding:32px 24px 8px">
              <img src="${LOGO_URL}" width="56" height="56" alt="GeoNotes" style="display:block;border:0;border-radius:12px" />
              <div style="margin-top:12px;color:#18181b;font-size:20px;font-weight:700;letter-spacing:.3px">GeoNotes</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:32px 32px 8px;text-align:center">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#18181b">Confirm your e-mail address</h1>
              <p style="margin:0;color:#52525b;font-size:15px;line-height:1.5">Enter this code to confirm your e-mail address and continue with GeoNotes:</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 8px">
              <div style="background:#ffffff;border:1px solid #fecaca;border-radius:12px;padding:20px;text-align:center;font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND_RED}">${code}</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 32px 28px;text-align:center">
              <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5">This code expires in 10 minutes. If you did not request it, you can safely ignore this e-mail.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 32px 28px;text-align:center;border-top:1px solid #e4e4e7">
              <div style="color:#71717a;font-size:13px;font-weight:600">GeoNotes</div>
              <div style="margin-top:4px;color:#a1a1aa;font-size:12px">Your location-pinned notepad</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
