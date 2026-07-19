# TODO

## Pages -> Workers cutover (manual steps, in order)

The code is done and tested on branch `eslint-setup` (which stacks on `worker-integration-tests` -> `workers-migration`). Nothing below is merged to `main` yet. Every step is reversible; the Pages project stays deployed and serving production until step 11.

Steps are marked DONE as they are completed, with what was found or decided recorded inline.

Every `wrangler` command below needs the API token first: `set -a; . ~/dev/.cloudflare-token.env; set +a`. Without it wrangler tries to open a browser to log in, which does not work under WSL.

1. ~~**Find the current `AUTH_SECRET` value.**~~ **DONE (2026-07-19), by rotation rather than recovery.**
   - **The original value is gone and is not recoverable.** Bash history (`~/.bash_history:1804-1806`) shows it was generated with `openssl rand -base64 32` and pasted into an interactive `wrangler pages secret put` prompt. History records the command, never the output or the stdin, so the value was never written to disk anywhere on this machine. Local `.dev.vars` only ever held the `dev-only-secret-not-for-production` placeholder.
   - **A fresh secret was generated** (`openssl rand -base64 32`) and **set on Pages production**, verified with `wrangler pages secret list` (AUTH_SECRET, RESEND_API_KEY, TURNSTILE_SECRET all present on the `production` environment).
   - **The value now lives in `.dev.vars` line 4.** That file is gitignored (`.gitignore:16`), so it will not be committed. Copy it into a password manager: `.dev.vars` is the only copy, and losing it repeats this whole problem.
   - Consequence of the rotation: any WebAuthn ceremony in flight at that moment failed. Sessions were unaffected, because they are opaque D1 tokens and are not signed with this secret. Pre-launch with no users, so the real blast radius was nil.
   - Note that local dev now runs with the production secret, since it is the same value in `.dev.vars`. Acceptable here, but worth remembering.
2. **Merge the branches to `main`.** `workers-migration` -> `worker-integration-tests` -> `eslint-setup`, or squash the chain, whichever you prefer.
   - **Safe to merge:** the Pages project was disconnected from the repository (confirmed 2026-07-19 via `wrangler pages project list`, which reports Git Provider `No` for `geonotes`). Merging no longer triggers a Pages build, which matters because `wrangler.toml` no longer has `pages_build_output_dir` and such a build would fail.
3. **`pnpm deploy`.** This creates the `geonotes-worker` Worker with **no route attached**: zero production impact, Pages is still serving every real user.
   - **This step moved ahead of setting the Worker secrets, deliberately.** `wrangler secret put` needs the Worker to exist first; before the deploy there is nothing to attach a secret to (`wrangler deployments list` errors out).
4. **Set the three Worker secrets:** `wrangler secret put AUTH_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET`. Then `wrangler secret list` to confirm all three are on `geonotes-worker`.
   - `AUTH_SECRET` must be byte-identical to the value now in `.dev.vars` line 4, which is what Pages holds. Piping avoids a paste error: `grep '^AUTH_SECRET=' .dev.vars | cut -d= -f2- | pnpm exec wrangler secret put AUTH_SECRET`.
   - Between step 1 and this step the two deployments hold **different** `AUTH_SECRET` values, so a passkey ceremony started on Pages cannot finish on the Worker. This does not matter while the Worker has no route (nobody reaches it), but do not attach the route in step 7 until this step is done.
   - `RESEND_API_KEY` and `TURNSTILE_SECRET` are also in `.dev.vars` and were **not** rotated; reuse them as-is.
5. **Smoke-test the `workers.dev` subdomain:** the SPA loads, a deep link falls back to the SPA, `/api/geocode?lat=1&lng=1` answers, `/api/nope` returns a plain-text 404. Passkeys and e-mail sign-in **will** fail there, because `RP_ID` and the CSRF origin check both name `gnotes.vshub.app`. That is correct behaviour, not a bug to chase.
6. **Confirm the cron fires.** `wrangler tail` and wait for the scheduled trigger. The purge is idempotent, so a clean no-op run is the expected result. Do not pass `--test-scheduled` on the staging server: it exposes a public `/__scheduled` endpoint that anyone could use to trigger the purge.
7. **Add a Worker Route `gnotes.vshub.app/*` -> `geonotes-worker`.** A Route, not a Custom Domain: a Custom Domain cannot be attached while Pages holds the hostname, which would force a detach-then-attach with a real DNS gap. A Route sits in front of the existing Pages domain with DNS untouched, takes effect in seconds, and **rolls back by deleting the route**. This is the moment production traffic moves.
8. **Verify production on `gnotes.vshub.app`:** the manifest says "GeoNotes" (not "GeoNotes Dev"), an existing session is still signed in, passkey login and registration both work, e-mail sign-in works, sync works, session revoke works, deletion request works. Watch `wrangler tail` for 500s.
9. **Verify the PWA install label** on Android and iOS, on both production ("GeoNotes") and staging ("GeoNotes Dev"). This is the one thing the test suite cannot check.
10. **Soak for a few days**, watching `wrangler tail` and D1 usage.
11. **Retire Pages.** As a separate, low-stakes change: swap the Route for a proper Custom Domain (this is the step that needs the Pages detach), then delete the `geonotes` Pages project.

Notes while both are live: the `geonotes-49a.pages.dev` deployment still reaches production D1, so it is a parallel path to the same data, not a sandbox. And do not bundle any frontend change into the cutover deploy: an unmodified frontend produces byte-identical hashed filenames, which keeps every installed service worker's precache valid across the switch.

---

## Features / fixes

- ~~Account purge on a real schedule.~~ **DONE on branch, not yet in production** (branch `workers-migration`; goes live with cutover step 3). The Workers migration added a `[triggers] crons` entry and a `scheduled` handler in `worker/index.ts` that runs `purgeExpiredDeletedAccounts` and `pruneExpiredEmailCodes`. The opportunistic `waitUntil` purge was **removed** from `email-request` (a 7-statement D1 batch on the hottest unauthenticated endpoint, for nothing, once a cron exists); the `pruneExpiredEmailCodes` call **stays** there, because it is genuinely amortised onto the request that grows the table. Confirm the cron actually fires after deploy, per cutover step 6.
  Original description follows. Account purge on a real schedule. The 30-day deletion sweep (`purgeExpiredDeletedAccounts`) currently runs opportunistically via `waitUntil` on `email-request`, so a doomed account is only purged once some address happens to request a code, and never if traffic goes quiet. Move it to a guaranteed cadence: a small standalone Worker with a Cron Trigger sharing the D1 binding that calls `purgeExpiredDeletedAccounts` (Cloudflare Pages has no cron trigger, which is why it piggybacks on a request today). Keep the opportunistic call as a cheap backstop or drop it once the cron path is live.
- Sweep orphan (credential-less) accounts. `passkey-register-options` inserts the `users` row before the passkey ceremony, so abandoning account creation after the e-mail code (dismissing the OS passkey prompt) leaves a `users` row with zero credentials and no session. It is harmless (only the owner, who controls the mailbox, can ever complete or reuse it) and reusing it via the create flow works, but it is never cleaned up and holds the address in the UNIQUE index forever. Add a scheduled delete of `users` rows that have no credentials, are not marked for deletion, and are older than the enroll-token TTL (10 min) with a comfortable margin (e.g. created over an hour ago). Fits naturally alongside `purgeExpiredDeletedAccounts` on the same Cron Trigger.
- Application/audit log for significant account lifecycle events. Persist an append-only record (e.g. a D1 table: event type, user id, e-mail or hashed e-mail, timestamp, and minimal context) for: account creation, e-mail change (from -> to), account deletion requested (user asks to delete, start of the 30-day window), and real account deletion (the scheduled job actually removes everything). Keep it privacy-conscious (no codes, no tokens) and use it for support/debugging and abuse investigation.
- ~~Set up ESLint.~~ **DONE (2026-07-19, branch `eslint-setup`).** ESLint 10 + typescript-eslint 8.64 with the type-checked rule set, plus react-hooks 7 and react-refresh on the frontend; `pnpm lint` added and documented in AGENTS.md.
  - **This pinned TypeScript to 6.0.3, down from 7.0.2.** typescript-eslint has an explicit guard that refuses to run on TypeScript 7, so type-aware linting and TS 7 cannot coexist today. Check typescript-eslint's peer range before bumping TypeScript again.
  - `no-unnecessary-type-assertion` and `require-await` are disabled for `worker/`, `shared/` and `test/`, because both misfire there: the Workers and Hono APIs are generic with a default that infers from the assertion itself, and the async stubs are async only to satisfy an interface.
  - Left behind, worth a follow-up: **three react-hooks 7 findings in existing frontend code are downgraded to warnings** so they do not block every lint run. `PasskeysSection.tsx:39` and `SessionsSection.tsx:45` call setState synchronously inside a mount effect; `EditorScreen.tsx:60` writes `textRef.current` during render. The third is a genuine React correctness smell.
  - One real bug was found and fixed: a dead `= null` initialiser on `outcome` in `worker/_lib/turnstile.ts`, whose `catch` always throws.
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
3. ~~**Migrate Pages -> Workers when D1 usage becomes a concern**~~ **IN PROGRESS as of 2026-07-19: the migration was done early, ahead of D1 pressure, to unlock the native rate limiter and the cron.** Code is complete and tested on branch; see the cutover checklist at the top of this file for the remaining manual steps. The native `AUTH_RATE_LIMITER` binding that `worker/_lib/rate-limit.ts` was already written against is now configured in `wrangler.toml` and becomes real on deploy. Original reasoning follows.
   **Migrate Pages -> Workers when D1 usage becomes a concern** (or a little before, if we want the payoff sooner). This is the real structural fix and has its own subsection below. It is deliberately *not* done now: it is a moderate migration with a WebAuthn-domain cutover, not worth it until D1 pressure is real or we want what it unlocks (native rate limiting + cron) for other reasons.

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
