/** Bindings and variables available to all GeoNotes Pages Functions. */
export interface Env {
  DB: D1Database
  /**
   * Secondary abuse-source throttle shared by e-mail authentication routes.
   * Workers-only binding, so it is absent on Cloudflare Pages; per-IP throttling
   * there is handled by a WAF Rate Limiting Rule and this stays undefined.
   */
  AUTH_RATE_LIMITER?: RateLimit
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
  /**
   * Cloudflare Turnstile secret key (set via
   * `wrangler pages secret put TURNSTILE_SECRET`). When present, `email-request`
   * requires a valid Turnstile token before issuing a code; when absent the
   * check is skipped (local dev) and the client renders no widget. Must be set
   * only after the matching client sitekey (VITE_TURNSTILE_SITEKEY) is deployed.
   */
  TURNSTILE_SECRET?: string
}
