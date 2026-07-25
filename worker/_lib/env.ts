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
  /**
   * The Android Credential Manager assertion origins, comma-separated, each of
   * the form `android:apk-key-hash:<base64url(SHA-256(signing cert DER))>`.
   * Unlike the web ceremony, a native passkey assertion carries one of these
   * instead of an https origin, so WebAuthn verification must accept them
   * alongside ORIGIN. Each is derived from a cert that signs an installed APK,
   * and a debug build and a Play App Signing build differ, so this is a list and
   * lives in config rather than being hardcoded. Absent off Android builds and in
   * tests, where only the web origin is expected.
   */
  ANDROID_PASSKEY_ORIGIN?: string
  /**
   * The Android application id whose Play Integrity tokens are accepted, and the
   * package the decode call is made against. Must match the installed APK's
   * `applicationId` (android/app/build.gradle), capacitor.config.ts `appId` and
   * the package registered on the linked Cloud project. A token whose decoded
   * request package differs is rejected, so a token minted for another app can
   * never authorize a GeoNotes e-mail request. Config rather than a constant for
   * the same reason RP_ID and ORIGIN are: a rename or a second flavour is then a
   * var change, not a Worker source edit.
   */
  ANDROID_PACKAGE?: string
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
  /**
   * Google service-account JSON key for the Play Integrity API (set via
   * `wrangler secret put PLAY_INTEGRITY_SA_JSON`, the full JSON file as one
   * value). The native Android build has no Turnstile widget; it sends a Play
   * Integrity token instead, which this key lets the Worker decode and verify
   * against Google. When present, `email-request` accepts a valid Play Integrity
   * token in lieu of a Turnstile token; when absent the native attestation check
   * is skipped (local dev), mirroring TURNSTILE_SECRET's no-op behaviour.
   */
  PLAY_INTEGRITY_SA_JSON?: string
  /**
   * When truthy ('1' or 'true'), Play Integrity verification additionally
   * requires full-strength verdicts (MEETS_DEVICE_INTEGRITY and a Play-recognized
   * app). Left unset during development so a sideloaded debug build, which Google
   * reports as UNRECOGNIZED_VERSION, still passes once its token decodes with a
   * matching package and request hash. Set it once the app ships from a Play
   * track.
   */
  PLAY_INTEGRITY_STRICT?: string
}
