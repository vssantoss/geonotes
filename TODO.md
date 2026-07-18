# TODO

## Features / fixes

- Account purge on a real schedule. The 30-day deletion sweep (`purgeExpiredDeletedAccounts`) currently runs opportunistically via `waitUntil` on `email-request`, so a doomed account is only purged once some address happens to request a code, and never if traffic goes quiet. Move it to a guaranteed cadence: a small standalone Worker with a Cron Trigger sharing the D1 binding that calls `purgeExpiredDeletedAccounts` (Cloudflare Pages has no cron trigger, which is why it piggybacks on a request today). Keep the opportunistic call as a cheap backstop or drop it once the cron path is live.
- Sweep orphan (credential-less) accounts. `passkey-register-options` inserts the `users` row before the passkey ceremony, so abandoning account creation after the e-mail code (dismissing the OS passkey prompt) leaves a `users` row with zero credentials and no session. It is harmless (only the owner, who controls the mailbox, can ever complete or reuse it) and reusing it via the create flow works, but it is never cleaned up and holds the address in the UNIQUE index forever. Add a scheduled delete of `users` rows that have no credentials, are not marked for deletion, and are older than the enroll-token TTL (10 min) with a comfortable margin (e.g. created over an hour ago). Fits naturally alongside `purgeExpiredDeletedAccounts` on the same Cron Trigger.
- Application/audit log for significant account lifecycle events. Persist an append-only record (e.g. a D1 table: event type, user id, e-mail or hashed e-mail, timestamp, and minimal context) for: account creation, e-mail change (from -> to), account deletion requested (user asks to delete, start of the 30-day window), and real account deletion (the scheduled job actually removes everything). Keep it privacy-conscious (no codes, no tokens) and use it for support/debugging and abuse investigation.
- Set up ESLint. The project currently has no linter (no `lint` script, no config, not installed), so nothing catches lint-level issues in CI or locally. Add ESLint with the TypeScript and React Hooks plugins, a `lint` script, and wire it into the verification pipeline alongside typecheck/build/test.
- Enable PostHog for product analytics.
- Donate button inside the About dialog. A simple link/button (alongside the existing Contact option) pointing to a donation destination so users can support the project. Decide the provider and keep it lightweight (an external link, no payment handling in-app).
- Privacy policy and terms of use page.

---

## Security & abuse hardening

Context for this whole section: because the app runs on Cloudflare Pages there is no fail2ban and no server to ban IPs on. That is fine. Cloudflare absorbs classic volumetric DDoS for us:

- **L3/L4 (network/transport) DDoS**: mitigated automatically and unmetered on every plan, including free. Nothing to configure.
- **L7 (HTTP) DDoS**: automatic managed rulesets run on all plans (sensitivity is fixed and non-tunable on free). Bot Fight Mode is available on free as a toggle.

So a classic "flood us offline" attack is Cloudflare's problem, not ours. What we own is **targeted, low-volume abuse that looks like legitimate traffic** and stays under DDoS thresholds: credential/email enumeration, a single IP grinding `/api/auth/*`, and D1 quota exhaustion. The app already backstops account-specific abuse (per-address email-code limits with atomic claims, input-size bounds on sync, the `requireTrustedOrigin` CSRF check, `Cache-Control: no-store`). The items below close the remaining gaps, edge rate limiting and D1 protection first.

### D1 abuse protection (priority)

The main worry. On the Cloudflare free plan D1 has daily read/write ceilings, and any endpoint that touches D1 *before* authentication is an amplification lever: an attacker can burn our daily quota cheaply and take sync/auth down for everyone without ever tripping the DDoS thresholds. Work this in order:

1. **Map every unauthenticated (or pre-auth) D1 touch.** Enumerate exactly which endpoints hit the database before a valid session exists, and how many reads/writes each costs. Known offenders today:
   - `email-request`: rate-limit-window upsert + code upsert + opportunistic prune (a DELETE batch across two tables).
   - `email-verify`: attempt-claim UPDATE.
   - `passkey-login-options` / `passkey-login`: credential/challenge lookups.
   - The sync push/pull path (authenticated, but the most expensive per-request D1 work, so it matters once a session exists).
   Each entry is a lever an attacker can pull; the list drives every mitigation below.
2. **Cap requests at the edge before they reach D1.** The WAF rate-limit rule (below) is the single most effective D1 protection: a request blocked at the edge costs zero D1. This is why the `/api/auth/` rule is the top security item.
3. **Move ephemeral, non-relational state off D1 onto KV or a Durable Object.** The email-code tables (`email_codes`, `email_code_rate_limits`) are TTL'd, address-keyed, and never joined, an ideal fit for KV (or a DO for the atomic counters). KV/DO reads and writes do **not** count against the D1 daily quota, so relocating this state removes the cheapest abuse lever entirely. Keep in D1 only what needs relational/transactional guarantees (users, credentials, sessions, notes).
4. **Stop per-request pruning from being an abuse lever.** The opportunistic prune fires a DELETE batch on every `email-request`. Confirm it stays off the response path (`waitUntil`), and consider moving pruning to a scheduled Cron trigger instead so an attacker hammering `email-request` cannot drive extra writes on our dime. A nightly sweep is cheaper and predictable.
5. **Bound distinct-address table growth.** Because the email-code tables key on address, an attacker cycling random addresses inserts one row each. The edge per-IP limit plus Turnstile on `email-request` (below) are what keep random-address flooding from ballooning those tables (and their write count).
6. **Defense-in-depth: a KV/cache per-IP pre-check inside the Function.** As a cheap backstop if a WAF rule is ever misconfigured or removed, gate the expensive handlers behind a KV counter (KV reads are far cheaper than D1 and off the D1 quota). Optional, only if we want belt-and-suspenders.
7. **Monitor D1 usage.** Set up a Cloudflare notification or a GraphQL Analytics alert on daily D1 read/write consumption so abuse surfaces as an alert well before it hits the ceiling, rather than as an outage.

### WAF rate limiting (edge)

Add a WAF Rate Limiting Rule for the auth endpoints (replaces the Workers-only rate-limit binding, which Pages does not support). In the Cloudflare dashboard: `gnotes.vshub.app` zone -> Security -> WAF -> Rate limiting rules -> Create rule.

- Match: `URI Path starts with /api/auth/` (optionally also `/api/geocode`).
- Counting characteristic: client IP.
- Rate: ~20 requests / 60s (matches the old in-code limit of 20/min).
- Action: Block, with a short mitigation timeout (e.g. 60s), returning 429.
- **Consider a second, looser rule on `/api/sync`** (e.g. ~60 requests / 60s per IP). Sync is authenticated but is our most expensive D1 path, so an abusive or compromised session is worth capping. Costs nothing to add.
- **Plan caveat:** the free plan allows exactly **one** WAF rate-limit rule (fixed 10s window, Block action). Paid plans allow multiple rules and per-second windows. Confirm which tier we're on first; if free, spend the single rule on `/api/auth/` and rely on the edge managed rules + app-layer limits for sync.
- After this is in place the per-IP throttle is fully at the edge; the app code already tolerates the missing `AUTH_RATE_LIMITER` binding (`functions/_lib/rate-limit.ts` no-ops when it's absent), so no redeploy is needed to switch it on.

### WAF custom rules (free, unlimited)

Separate from rate limiting, WAF custom rules are free and unlimited on all plans. Use them for cheap static blocks that never need to reach a Function or D1:

- Block unexpected HTTP methods / paths on the API surface.
- Challenge or block requests missing headers a real browser client always sends.
- Block known-bad ASNs/bots if a pattern emerges from the D1 usage monitoring.

### Turnstile on email-request

Add Turnstile to the `email-request` flow for stronger bot resistance. This is the highest-leverage addition after the rate-limit rule: sending an e-mail is the one action that costs *us* money and reputation per request and can be used to spam third parties. A rate limit only slows it; Turnstile makes automated abuse structurally hard and directly protects the email-code D1 tables from random-address flooding (see D1 item 5). The `turnstile-spin` skill can help wire it up.

### D1 cost audit (free-tier headroom)

Audit D1 database usage/cost to stay on the Cloudflare free plan. Count reads/writes per flow (sync push/pull, auth, email codes, rate limiting, sessions) against the free-tier daily limits, and for each database touch ask whether the same thing can be done 100% safely without D1 (client-side, cookie/token-encoded, KV, or cache). Only keep a database operation when there is no equally safe alternative. This audit and the D1 abuse work above overlap: fewer DB touches per request means both lower steady-state cost and less amplification an attacker can exploit.

### Security integration tests

Security integration tests (all terminal-runnable, no browser). Add the Workers Vitest pool (`@cloudflare/vitest-pool-workers` + Miniflare D1 seeded from `migrations/`) for the functions, and `fake-indexeddb` + jsdom for the client sync logic. Cover the report's assurance list:

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

### Native bot resistance (Play Integrity / App Attest)

Turnstile is the web answer for "is this a real human/browser", but it is web-first: there is no official native mobile SDK, and in a Capacitor webview the widget origin is `localhost` (`https://localhost` / `capacitor://localhost`), which both weakens the siteverify hostname signal and is finicky around `Origin`/`Referer`. Do not force Turnstile through the webview as the primary native defense. Use the platform attestation APIs instead, which are purpose-built for "is this a genuine, unmodified instance of our app": **Play Integrity** on Android and **App Attest / DeviceCheck** on iOS.

The constraint that makes this non-optional: once `email-request` *requires* a proof-of-humanity token (see "Turnstile on email-request"), every client must supply one, including native. Do not add a "skip if native" bypass, since a client-asserted native flag is trivially forgeable and reopens the exact abuse hole Turnstile closes.

- Backend: have the pre-auth email/abuse-sensitive endpoints (`email-request` first) accept **either** a Turnstile token (web) **or** a valid attestation token (native), and verify each server-side. Reject requests carrying neither. Keep the per-IP edge rate limit as the floor under both.
- Android: obtain a Play Integrity token in the app, send it with the request, and verify it server-side against Google's Play Integrity API (check app package, signing cert, and integrity verdicts). Requires a Google Play project and a service credential for verification.
- iOS (when that build happens): App Attest to bind a hardware key to the app instance, then assert per request; verify server-side. DeviceCheck as the lighter-weight fallback.
- Sequencing: land web Turnstile on `email-request` first (the backend gains the "token required" contract), then add the native attestation branch before shipping account creation in the Android app, so native signup is never left either unprotected or broken.
