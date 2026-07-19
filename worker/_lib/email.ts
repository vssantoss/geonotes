import type { Env } from './env'

/** The address confirmation codes are sent from. Must be on a Resend-verified domain. */
const MAIL_FROM = 'GeoNotes <gnotes@vshub.app>'
/** Where contact-form messages are delivered (the app owner's inbox). */
const CONTACT_TO = 'victor@victorsantos.org'
/** Resend's REST endpoint for sending a single e-mail. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'
/** Hosted app icon used as the email logo (data URIs are blocked by most clients). */
const LOGO_URL = 'https://gnotes.vshub.app/pwa-192x192.png'
/** Brand red, taken from the app icon (favicon.svg). */
const BRAND_RED = '#b91c1c'

/** Delivers account e-mails. Swap the implementation to wire a real provider. */
export interface EmailSender {
  /**
   * Sends an e-mail confirmation code to an address.
   *
   * @param to - recipient e-mail address.
   * @param code - the 6-digit code.
   */
  sendCode(to: string, code: string): Promise<void>

  /**
   * Welcomes a newly created account with a warm, personal thank-you note that
   * also states the app's no-tracking privacy stance and points to the in-app
   * contact and donate options.
   *
   * @param to - recipient e-mail address.
   */
  sendWelcome(to: string): Promise<void>

  /**
   * Notifies an address that its account was scheduled for deletion, explaining
   * the 30-day grace window and how to cancel it.
   *
   * @param to - recipient e-mail address.
   */
  sendAccountDeletionNotice(to: string): Promise<void>

  /**
   * Delivers a contact-form message to the app owner's inbox. The sender's
   * address is set as the Reply-To so a plain "reply" reaches the user without
   * the owner having to copy the address out of the body.
   *
   * @param fromEmail - the signed-in user's e-mail address (the Reply-To).
   * @param message - the plain-text message the user typed.
   */
  sendContactMessage(fromEmail: string, message: string): Promise<void>
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

  /**
   * No-op welcome in dev, so account creation works without a mail provider.
   *
   * @param to - recipient e-mail address.
   */
  async sendWelcome(_to: string): Promise<void> {}

  /**
   * No-op deletion notice in dev, so the flow works without a mail provider.
   *
   * @param to - recipient e-mail address.
   */
  async sendAccountDeletionNotice(_to: string): Promise<void> {}

  /**
   * No-op contact delivery in dev, so the form works without a mail provider.
   *
   * @param fromEmail - the signed-in user's e-mail address.
   * @param message - the plain-text message the user typed.
   */
  async sendContactMessage(_fromEmail: string, _message: string): Promise<void> {}
}

/** Sends account e-mails through Resend's REST API. */
class ResendEmailSender implements EmailSender {
  /**
   * @param apiKey - Resend API key with sending permission.
   */
  constructor(private readonly apiKey: string) {}

  /**
   * E-mails a confirmation code, sending both HTML and plain-text bodies (the
   * text part improves deliverability and covers text-only clients).
   *
   * @param to - recipient e-mail address.
   * @param code - the 6-digit code.
   * @throws Error when Resend rejects the request.
   */
  async sendCode(to: string, code: string): Promise<void> {
    await this.send(to, `${code} is your GeoNotes confirmation code`, codeText(code), codeHtml(code))
  }

  /**
   * E-mails the welcome note to a newly created account, reusing the shared
   * branded template.
   *
   * @param to - recipient e-mail address.
   * @throws Error when Resend rejects the request.
   */
  async sendWelcome(to: string): Promise<void> {
    await this.send(to, 'Welcome to GeoNotes', welcomeText(), welcomeHtml())
  }

  /**
   * E-mails the account-deletion notice, reusing the same branded template as
   * the confirmation code.
   *
   * @param to - recipient e-mail address.
   * @throws Error when Resend rejects the request.
   */
  async sendAccountDeletionNotice(to: string): Promise<void> {
    await this.send(
      to,
      'Your GeoNotes account is scheduled for deletion',
      deletionNoticeText(),
      deletionNoticeHtml(),
    )
  }

  /**
   * E-mails a contact-form message to the app owner, with the sender's address
   * as Reply-To so replying goes straight back to the user.
   *
   * @param fromEmail - the signed-in user's e-mail address.
   * @param message - the plain-text message the user typed.
   * @throws Error when Resend rejects the request.
   */
  async sendContactMessage(fromEmail: string, message: string): Promise<void> {
    await this.send(
      CONTACT_TO,
      'New GeoNotes contact message',
      contactText(fromEmail, message),
      contactHtml(fromEmail, message),
      fromEmail,
    )
  }

  /**
   * Posts one e-mail to Resend.
   *
   * @param to - recipient e-mail address.
   * @param subject - the subject line.
   * @param text - the plain-text body.
   * @param html - the HTML body.
   * @param replyTo - optional Reply-To address.
   * @throws Error when Resend rejects the request.
   */
  private async send(
    to: string,
    subject: string,
    text: string,
    html: string,
    replyTo?: string,
  ): Promise<void> {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to,
        subject,
        text,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
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
 * Wraps message-specific rows in the shared branded e-mail shell: the logo
 * header and the footer, inside a rounded card.
 *
 * Table-based with inline styles so it renders consistently across e-mail
 * clients (including Outlook), and pulls the logo from a hosted URL because
 * most clients block data-URI images.
 *
 * @param contentRows - the message-specific `<tr>` rows shown between the header
 *   and the footer.
 * @returns the full HTML document.
 */
function emailShell(contentRows: string): string {
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
          ${contentRows}
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

/**
 * Builds the HTML body for a confirmation-code e-mail.
 *
 * @param code - the 6-digit code.
 * @returns the HTML body.
 */
function codeHtml(code: string): string {
  return emailShell(`
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
          </tr>`)
}

/**
 * Builds the plain-text body for the welcome e-mail.
 *
 * @returns the text body.
 */
function welcomeText(): string {
  return [
    'Welcome to GeoNotes, and thank you.',
    '',
    "Creating an account here genuinely means a lot to me. GeoNotes is a small, independent project, and every person who decides to give it a place on their phone makes it worth building.",
    '',
    'A word on privacy, because it matters to me as much as it does to you: GeoNotes will never sell or share your data, shows you no ads, and uses no third-party trackers that follow you around the web. Your notes are yours alone. The few tools I rely on are chosen specifically because they respect your privacy: they help me understand how to make GeoNotes better, never to profile or identify you.',
    '',
    'If an idea for making GeoNotes better ever crosses your mind, there is a contact form inside the About dialog. I read every message. And if you ever feel in your heart to help the project along, a Donate option lives there too, entirely optional and deeply appreciated.',
    '',
    'Made with love,',
    'Victor Santos',
  ].join('\n')
}

/**
 * Builds the HTML body for the welcome e-mail, reusing the shared branded shell.
 * The closing mirrors the app's About dialog: "Made with" and a heart, signed
 * by name.
 *
 * @returns the HTML body.
 */
function welcomeHtml(): string {
  return emailShell(`
          <tr>
            <td align="center" style="padding:32px 32px 8px;text-align:center">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#18181b">Welcome to GeoNotes</h1>
              <p style="margin:0;color:#52525b;font-size:15px;line-height:1.6">Creating an account here genuinely means a lot to me. GeoNotes is a small, independent project, and every person who gives it a place on their phone makes it worth building.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 8px">
              <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:16px 20px;color:#52525b;font-size:14px;line-height:1.6;text-align:center">
                A word on privacy, because it matters to me as much as it does to you: GeoNotes will <strong style="color:#18181b">never sell or share your data</strong>, shows you <strong style="color:#18181b">no ads</strong>, and uses <strong style="color:#18181b">no third-party trackers</strong> that follow you around the web. Your notes are yours alone. The few tools I rely on are chosen specifically because they respect your privacy: they help me understand how to make GeoNotes better, never to profile or identify you.
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 32px 8px;text-align:center">
              <p style="margin:0;color:#52525b;font-size:15px;line-height:1.6">If an idea for making GeoNotes better ever crosses your mind, there is a contact form inside the <strong style="color:#18181b">About</strong> dialog, I read every message. And if you ever feel in your heart to help the project along, a <strong style="color:#18181b">Donate</strong> option lives there too: entirely optional, and deeply appreciated.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 32px 28px;text-align:center">
              <p style="margin:0;color:#52525b;font-size:15px;line-height:1.6">Made with <span style="color:#ef4444">&#10084;</span></p>
              <p style="margin:2px 0 0;color:#18181b;font-size:15px;font-weight:700">Victor Santos</p>
            </td>
          </tr>`)
}

/**
 * Escapes the five HTML-significant characters so user-typed text is rendered
 * verbatim and can never inject markup into the e-mail body.
 *
 * @param value - raw user input.
 * @returns the HTML-escaped string.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Builds the plain-text body for a contact-form message.
 *
 * @param fromEmail - the sender's e-mail address.
 * @param message - the plain-text message the user typed.
 * @returns the text body.
 */
function contactText(fromEmail: string, message: string): string {
  return `New contact message from ${fromEmail}:\n\n${message}\n\nReply to this e-mail to respond directly to the sender.`
}

/**
 * Builds the HTML body for a contact-form message, reusing the shared branded
 * shell. The message is HTML-escaped and shown with preserved line breaks; no
 * user text is treated as markup.
 *
 * @param fromEmail - the sender's e-mail address.
 * @param message - the plain-text message the user typed.
 * @returns the HTML body.
 */
function contactHtml(fromEmail: string, message: string): string {
  return emailShell(`
          <tr>
            <td align="center" style="padding:32px 32px 8px;text-align:center">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#18181b">New contact message</h1>
              <p style="margin:0;color:#52525b;font-size:15px;line-height:1.5">From <strong style="color:${BRAND_RED}">${escapeHtml(fromEmail)}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 8px">
              <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:16px 20px;color:#18181b;font-size:15px;line-height:1.6;white-space:pre-wrap;word-break:break-word">${escapeHtml(message)}</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 32px 28px;text-align:center">
              <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5">Reply to this e-mail to respond directly to the sender.</p>
            </td>
          </tr>`)
}

/**
 * Builds the plain-text body for the account-deletion notice.
 *
 * @returns the text body.
 */
function deletionNoticeText(): string {
  return `Thanks for using GeoNotes. We've received your request to delete your account. Your account and all your notes will be permanently removed in 30 days. Changed your mind? Sign back in with the "Recover account" option before then to cancel the deletion and restore everything. If you meant to delete your account, no further action is needed and your data will be erased automatically.`
}

/**
 * Builds the HTML body for the account-deletion notice, reusing the shared
 * confirmation-e-mail shell.
 *
 * @returns the HTML body.
 */
function deletionNoticeHtml(): string {
  return emailShell(`
          <tr>
            <td align="center" style="padding:32px 32px 8px;text-align:center">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#18181b">Your account is scheduled for deletion</h1>
              <p style="margin:0 0 12px;color:#52525b;font-size:15px;line-height:1.5">Thanks for using GeoNotes. We&rsquo;ve received your request to delete your account.</p>
              <p style="margin:0;color:#52525b;font-size:15px;line-height:1.5">Your account and all your notes will be permanently removed in <strong>30 days</strong>.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 8px">
              <div style="background:#ffffff;border:1px solid #fecaca;border-radius:12px;padding:16px 20px;text-align:center;color:#52525b;font-size:14px;line-height:1.5">Changed your mind? Sign back in with the <strong style="color:${BRAND_RED}">Recover account</strong> option before then to cancel the deletion and restore everything.</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 32px 28px;text-align:center">
              <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5">If you meant to delete your account, no further action is needed. Your data will be erased automatically.</p>
            </td>
          </tr>`)
}
