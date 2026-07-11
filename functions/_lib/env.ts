/** Bindings and variables available to all GeoNotes Pages Functions. */
export interface Env {
  DB: D1Database
  /** 'dev' enables the e-mail code echo; anything else is production. */
  ENVIRONMENT: string
  /** WebAuthn relying party id: the domain the app is served from. */
  RP_ID: string
  /** Full origin the app is served from, for WebAuthn verification. */
  ORIGIN: string
  /** Secret for HMAC-signing WebAuthn challenges (set via `wrangler pages secret put AUTH_SECRET`). */
  AUTH_SECRET: string
}
