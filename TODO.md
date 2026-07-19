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

### D1 abuse protection

The main worry. On the Cloudflare free plan D1 has daily read/write ceilings (roughly 100K writes/day, with far more generous reads), and any endpoint that touches D1 *before* authentication is an amplification lever: an attacker can burn our daily quota cheaply and take sync/auth down for everyone without ever tripping the DDoS thresholds.

**Decided strategy (2026-07):** ship no new in-code protection now. The app already backstops the abuse that actually matters (per-address email-code limits with atomic claims, Turnstile on `email-request`, input-size bounds on sync, `requireTrustedOrigin`, `Cache-Control: no-store`). The plan, in ascending order of effort:

1. **WAF rate-limit rule at the edge, if the free plan exposes it** (see "WAF rate limiting" below). A request blocked at the edge costs zero D1, so this is the single highest-value lever and it needs no code and no redeploy. The free plan allows exactly one rate-limit rule; spend it on `/api/auth/`. If it turns out the free plan does not expose the feature at all, skip it and lean on the managed rulesets plus the existing app-layer limits.
2. **Monitor D1 usage** (see "Monitor D1 usage" below) so consumption surfaces as an alert well before the ceiling, not as an outage.
3. **Migrate Pages -> Workers when D1 usage becomes a concern** (or a little before, if we want the payoff sooner). This is the real structural fix and has its own subsection below. It is deliberately *not* done now: it is a moderate migration with a WebAuthn-domain cutover, not worth it until D1 pressure is real or we want what it unlocks (native rate limiting + cron) for other reasons.

Two earlier ideas from this plan are explicitly abandoned, because they do not survive the free-tier quota math:

- **Do NOT move the email-code tables to KV.** KV's free-tier ceiling is only ~1,000 writes/day, about 100x smaller than D1's ~100K, and that state is write-heavy (a rate-limit upsert + a code upsert per request). Relocating it to KV would shrink the abuse target 100x, the opposite of the goal. If this state ever leaves D1 it goes to a Durable Object, not KV, and only as part of the Workers migration.
- **Do NOT hand-roll an in-code per-IP counter on Pages.** A KV counter dies at 1,000 writes/day, and a Durable Object counter cannot be defined inside Pages Functions (the DO class must live in a separate Worker), so it drags a Worker in anyway. Once we are on Workers this whole idea collapses into the native Rate Limiting binding, which `functions/_lib/rate-limit.ts` is already written against and which consumes no D1/KV/DO quota.

For reference, the pre-auth D1 touches an attacker can lever (this list drives the WAF match and the migration priorities):

- `email-request`: rate-limit-window upsert + code upsert + opportunistic prune (a DELETE batch across two tables).
- `email-verify`: attempt-claim UPDATE.
- `passkey-login-options` / `passkey-login`: credential/challenge lookups.
- sync push/pull: authenticated, but the most expensive per-request D1 work, so it matters once a session exists.

### Migrate Cloudflare Pages -> Workers

The structural answer to D1 abuse, and to the two scheduled-job gaps in the Features list at the top of this file. Cloudflare now recommends Workers (with static assets) over Pages for new work, and Workers exposes two primitives Pages structurally cannot:

- **The native Rate Limiting binding**: the correct, quota-free per-IP limiter. `functions/_lib/rate-limit.ts` already calls `env.AUTH_RATE_LIMITER.limit({ key })` and no-ops today only because the binding is Workers-only. After migration it just works: no Durable Object, no counter code, no fail-open/closed edge cases.
- **Cron Triggers**: retires the two `waitUntil`-piggybacked jobs (`purgeExpiredDeletedAccounts` and the orphan-account sweep, both in the Features list above) that today only run when some address happens to request a code. It also lets the email-code prune move to a nightly sweep instead of firing a DELETE batch on every `email-request`.

**What ports for free (~95%):** every handler body and everything in `functions/_lib/` is plain `(request, env, ctx)` logic with no Pages dependency, so it moves essentially unchanged.

**What it actually costs:**

- *Routing.* Pages file-based routing (19 endpoints plus two dynamic `[id]` routes) has to become an explicit router. The `route()` wrapper signature changes from `EventContext` to `(request, env, ctx)`, and `waitUntil` moves to `ctx.waitUntil` (touches `email-request.ts`, which uses it twice).
- *`_middleware.ts`.* Its `HTMLRewriter` + `/manifest.webmanifest` relabel logic rewires to run the Worker first, call `env.ASSETS.fetch(request)`, then apply the rewriter to the result. The one genuinely rearchitected file.
- *Static assets + config.* `vite build` still emits `dist/` unchanged. `wrangler.toml` swaps `pages_build_output_dir` for `main = <worker entry>` plus an `[assets]` block, with the Worker running before assets so `/api/*` is seen first.
- *Re-provisioning.* Re-put secrets with `wrangler secret put` (`AUTH_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET`); the D1 binding and `database_id` carry over. Local and staging tooling changes: `wrangler pages dev dist` (port 8788, behind the `/srv` nginx + cloudflared tunnel) becomes `wrangler dev`, and `wrangler pages deploy dist` becomes `wrangler deploy`.
- *Cutover risk.* WebAuthn is scoped to `gnotes.vshub.app`; moving that hostname from the Pages project to the Worker must be clean or passkeys break for everyone. Stage it: deploy the Worker on a temporary hostname, verify passkey register/login, then move the custom domain. Reversible, keep the Pages project until the Worker is verified. No data migration (same D1).

**Rough size:** most of a focused day of code and config, plus a carefully staged domain cutover.

### Monitor D1 usage

Set up a Cloudflare notification or a GraphQL Analytics alert on daily D1 read/write consumption so abuse (or plain organic growth) surfaces as an alert well before it hits the ceiling, rather than as an outage. This is also the trigger signal for the Pages -> Workers migration above: when consumption trends toward the free-tier limit, that is the cue to migrate.

### WAF rate limiting (edge)

Add a WAF Rate Limiting Rule for the auth endpoints (replaces the Workers-only rate-limit binding, which Pages does not support). In the Cloudflare dashboard: `gnotes.vshub.app` zone -> Security -> WAF -> Rate limiting rules -> Create rule.

- Match: `URI Path starts with /api/auth/` (optionally also `/api/geocode`).
- Counting characteristic: client IP.
- Rate: ~20 requests / 60s (matches the old in-code limit of 20/min).
- Action: Block, with a short mitigation timeout (e.g. 60s), returning 429.
- **Consider a second, looser rule on `/api/sync`** (e.g. ~60 requests / 60s per IP). Sync is authenticated but is our most expensive D1 path, so an abusive or compromised session is worth capping. Costs nothing to add.
- **Plan caveat:** the free plan allows exactly **one** WAF rate-limit rule (fixed 10s window, Block action). Paid plans allow multiple rules and per-second windows. Confirm which tier we're on first; if free, spend the single rule on `/api/auth/` and rely on the edge managed rules + app-layer limits for sync.
- After this is in place the per-IP throttle is fully at the edge; the app code already tolerates the missing `AUTH_RATE_LIMITER` binding (`functions/_lib/rate-limit.ts` no-ops when it's absent), so no redeploy is needed to switch it on.
- This edge rule is the interim answer while we stay on Pages. The Pages -> Workers migration above is what eventually moves the per-IP limit in-code onto the native Rate Limiting binding (`rate-limit.ts` is already written for it); the WAF rule and the binding can also coexist, edge as the outer floor and the binding as the inner one.

### WAF custom rules (free, unlimited)

Separate from rate limiting, WAF custom rules are free and unlimited on all plans. Use them for cheap static blocks that never need to reach a Function or D1:

- Block unexpected HTTP methods / paths on the API surface.
- Challenge or block requests missing headers a real browser client always sends.
- Block known-bad ASNs/bots if a pattern emerges from the D1 usage monitoring.

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
