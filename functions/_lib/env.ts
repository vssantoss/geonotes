/** Bindings and variables available to all GeoNotes Pages Functions. */
export interface Env {
  DB: D1Database
  /** 'dev' enables the e-mail code echo; anything else is production. */
  ENVIRONMENT: string
  /** WebAuthn relying party id: the domain the app is served from. */
  RP_ID: string
  /** Full origin the app is served from, for WebAuthn verification. */
  ORIGIN: string
  /** Secret for HMAC-signing enroll tokens (set via `wrangler pages secret put AUTH_SECRET`). */
  AUTH_SECRET: string
  /**
   * Resend API key (set via `wrangler pages secret put RESEND_API_KEY`).
   * When present, sign-in codes are e-mailed via Resend; when absent the code
   * is logged to the console instead so local dev works without a provider.
   */
  RESEND_API_KEY?: string
}
