/** Bindings and variables available to all GeoNotes Pages Functions. */
export interface Env {
  DB: D1Database
  /** Secondary abuse-source throttle shared by e-mail authentication routes. */
  AUTH_RATE_LIMITER: RateLimit
  /** 'dev' enables the e-mail code echo; other values require a real sender. */
  ENVIRONMENT: string
  /** WebAuthn relying party id: the domain the app is served from. */
  RP_ID: string
  /** Full origin the app is served from, for WebAuthn verification. */
  ORIGIN: string
  /** Secret for HMAC-signing enroll tokens (set via `wrangler pages secret put AUTH_SECRET`). */
  AUTH_SECRET: string
  /**
   * Resend API key (set via `wrangler pages secret put RESEND_API_KEY`).
   * When present, sign-in codes are e-mailed via Resend. It may be absent only
   * in dev, where the code is returned to the local UI without being logged.
   */
  RESEND_API_KEY?: string
}
