# TODO

- Add a WAF Rate Limiting Rule for the auth endpoints (replaces the Workers-only rate-limit binding, which Pages does not support). In the Cloudflare dashboard: `gnotes.vshub.app` zone -> Security -> WAF -> Rate limiting rules -> Create rule.
  - Match: `URI Path starts with /api/auth/` (optionally also `/api/geocode`).
  - Counting characteristic: client IP.
  - Rate: ~20 requests / 60s (matches the old in-code limit of 20/min).
  - Action: Block, with a short mitigation timeout (e.g. 60s), returning 429.
  - After this is in place the per-IP throttle is fully at the edge; the app code already tolerates the missing `AUTH_RATE_LIMITER` binding, so no redeploy is needed to switch it on.
- Turnstile on `email-request` for stronger bot resistance.
- Settings page:
   - Delete account: a settings option that, on click, opens a warning/confirmation dialog before doing anything. Confirming does NOT delete immediately; it marks the account for deletion (record the deletion-requested timestamp) and signs the user out. The account and its data (user row, credentials, sessions, email codes, synced notes) are permanently removed 30 days later by a scheduled job. During those 30 days the e-mail address stays reserved and cannot be used (account creation, e-mail change, or recovery must treat a marked-for-deletion address as unavailable). Decide whether signing back in within the window cancels the deletion (recommended) and surface that in the UI.
- Application/audit log for significant account lifecycle events. Persist an append-only record (e.g. a D1 table: event type, user id, e-mail or hashed e-mail, timestamp, and minimal context) for: account creation, e-mail change (from -> to), account deletion requested (user asks to delete, start of the 30-day window), and real account deletion (the scheduled job actually removes everything). Keep it privacy-conscious (no codes, no tokens) and use it for support/debugging and abuse investigation.
- Set up ESLint. The project currently has no linter (no `lint` script, no config, not installed), so nothing catches lint-level issues in CI or locally. Add ESLint with the TypeScript and React Hooks plugins, a `lint` script, and wire it into the verification pipeline alongside typecheck/build/test.
- Audit D1 database usage/cost to stay on the Cloudflare free plan. Count reads/writes per flow (sync push/pull, auth, email codes, rate limiting, sessions) against the free-tier daily limits, and for each database touch ask whether the same thing can be done 100% safely without D1 (client-side, cookie/token-encoded, KV, or cache). Only keep a database operation when there is no equally safe alternative.
- Security integration tests (all terminal-runnable, no browser). Add the Workers Vitest pool (`@cloudflare/vitest-pool-workers` + Miniflare D1 seeded from `migrations/`) for the functions, and `fake-indexeddb` + jsdom for the client sync logic. Cover the report's assurance list:
  - Unauthenticated request cannot enroll a passkey on an existing account.
  - Registration cannot attach an unverified e-mail address.
  - A WebAuthn challenge succeeds at most once (replay is rejected).
  - Concurrent invalid email-code attempts cannot exceed the attempt limit (fire N parallel requests).
  - A credential ID cannot be reassigned to another user.
  - Every sync read and mutation stays scoped to the authenticated user.
  - A previous account's outbox is never pushed under a new account (A -> B switch; guards the owner-tagging fix in commit f95b466).
  - Changing the account e-mail to an address already owned by a different account is rejected with 409 and leaves the user row unchanged (`email-change.ts`). Deferred from the Settings work because it needs this harness: the endpoint runs `requireUser` (seeded session row + matching cookie), `verifyEnrollToken` (a validly HMAC-signed token minted with the test secret), and two SQL statements against a `users`-seeded D1, none of which the current pure-unit function tests provide. Cheap to add once the harness exists.
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
