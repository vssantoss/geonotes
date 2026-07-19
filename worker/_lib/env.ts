/**
 * Bindings and variables available to the GeoNotes Worker.
 *
 * Declared as a type alias rather than an interface because Hono constrains its
 * `Bindings` generic to `Record<string, unknown>`, which only a type alias
 * satisfies (interfaces get no implicit index signature).
 */
export type Env = {
  DB: D1Database
  /** Static assets binding: the built `dist/` folder, with SPA fallback. */
  ASSETS: Fetcher
  /**
   * Secondary abuse-source throttle shared by e-mail authentication routes.
   * Per-colo and eventually consistent, so it is the cheap inner layer that
   * fails fast before D1, not a replacement for the zone's WAF rate-limit rule.
   */
  AUTH_RATE_LIMITER?: RateLimit
  /** 'dev' enables the e-mail code echo; other values require a real sender. */
  ENVIRONMENT: string
  /** WebAuthn relying party id: the domain the app is served from. */
  RP_ID: string
  /** Full origin the app is served from, for WebAuthn verification. */
  ORIGIN: string
  /** Secret for HMAC-signing enroll tokens (set via `wrangler secret put AUTH_SECRET`). */
  AUTH_SECRET: string
  /**
   * Resend API key (set via `wrangler secret put RESEND_API_KEY`).
   * When present, sign-in codes are e-mailed via Resend. It may be absent only
   * in dev, where the code is returned to the local UI without being logged.
   */
  RESEND_API_KEY?: string
  /**
   * Cloudflare Turnstile secret key (set via
   * `wrangler secret put TURNSTILE_SECRET`). When present, `email-request`
   * requires a valid Turnstile token before issuing a code; when absent the
   * check is skipped (local dev) and the client renders no widget. Must be set
   * only after the matching client sitekey (VITE_TURNSTILE_SITEKEY) is deployed.
   */
  TURNSTILE_SECRET?: string
}
