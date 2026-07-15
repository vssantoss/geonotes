# TODO

- Turnstile on `email-request` for stronger bot resistance.
- Add a timer/countdown on the Send/Resend email code button (reflect the 60s resend cooldown so users see when they can request again).
- Settings page:
  - Manage passkeys associated with the account (list, add, remove).
  - Session management: list active sessions, revoke one, revoke-all ("sign out everywhere"). Needs server endpoints and a bit more stored per session (created-at, last-seen, device label).
  - Change account e-mail (verify the new address before switching).
  - Language switch.
  - Theme switch (move it here and remove it from the top bar).
  - Distance units switch (meters/feet).
- Audit D1 database usage/cost to stay on the Cloudflare free plan. Count reads/writes per flow (sync push/pull, auth, email codes, rate limiting, sessions) against the free-tier daily limits, and for each database touch ask whether the same thing can be done 100% safely without D1 (client-side, cookie/token-encoded, KV, or cache). Only keep a database operation when there is no equally safe alternative.
- Security integration tests (all terminal-runnable, no browser). Add the Workers Vitest pool (`@cloudflare/vitest-pool-workers` + Miniflare D1 seeded from `migrations/`) for the functions, and `fake-indexeddb` + jsdom for the client sync logic. Cover the report's assurance list:
  - Unauthenticated request cannot enroll a passkey on an existing account.
  - Registration cannot attach an unverified e-mail address.
  - A WebAuthn challenge succeeds at most once (replay is rejected).
  - Concurrent invalid email-code attempts cannot exceed the attempt limit (fire N parallel requests).
  - A credential ID cannot be reassigned to another user.
  - Every sync read and mutation stays scoped to the authenticated user.
  - A previous account's outbox is never pushed under a new account (A -> B switch; guards the owner-tagging fix in commit f95b466).
  - Auth and sync responses send `Cache-Control: no-store`.
  - Oversized bodies / excessive ops are rejected before expensive processing.
  - Authenticate in tests by seeding a session row in the test D1 (bypass the passkey ceremony). Only the successful register/login happy path needs a real signed authenticator response: record one ceremony's JSON from a browser once and replay it as a fixture. Everything else needs no fixture.

---

## Android app (Capacitor)

Start work on the Android build of the app.

IMPORTANT auth caveat, do not just reuse the web session transport. The web app authenticates with an HttpOnly `__Host-geonotes_session` cookie plus `SameSite=Strict` and a server-side `Origin` check (`requireTrustedOrigin`). That design is web-origin only and will not work from a Capacitor webview:

- A Capacitor webview serves the UI from a local scheme (`capacitor://localhost` / `https://localhost`), so calls to the remote API are cross-site. `SameSite=Strict` means the session cookie is never attached, so every request is unauthenticated even after a successful login.
- Even if a cookie attached, the webview's `Origin` is not `env.ORIGIN`, so `requireTrustedOrigin` returns 403 on every non-GET.
- iOS WKWebView (and increasingly Android) block cross-site cookie storage, so the `Set-Cookie` may be dropped entirely.
- The trap: making the cookie work in native tempts loosening `SameSite`, the `__Host-` prefix, or the `Origin` check, which would undo the CSRF/cross-site protections the security work just added. Do not weaken those.

What native should do instead:

- Keep the session token in platform secure storage (Android Keystore / EncryptedSharedPreferences), send it explicitly (e.g. Authorization header), and give the API a native-aware, CSRF-safe auth path separate from the browser cookie flow. A native app is not subject to browser CSRF the same way.
- WebAuthn/passkeys need platform APIs and Android Digital Asset Links (assetlinks.json) for the RP; `RP_ID` is currently scoped to `gnotes.vshub.app`. Plan passkey support as its own piece.
- Decide the model: thin wrapper around the hosted PWA vs. a build that bundles the client and talks to the API. Either way the auth transport above still applies.
