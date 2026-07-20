# PENDING

Working list for the Pages -> Workers cutover and everything it left behind. Written 2026-07-19, right after production traffic moved to the Worker.

Ordered by risk, not by effort. Work top-down. Tick items as they are done and record what you found next to them, the same way `TODO.md` does, so this file stays useful after the fact.

`TODO.md` holds the long-lived backlog. This file is the short-lived one and should be deleted once it is empty.

---

## Where things actually stand

**Production is on the Worker.** `gnotes.vshub.app` is served by `geonotes-worker`. Verified by three independent signals that Pages could not produce:

- `/api/nope` returns `404 text/plain` with body `not found`. On Pages the same request falls through to the SPA and returns a **200 with `index.html`**.
- API responses carry `x-content-type-options: nosniff` and `referrer-policy: no-referrer`, which only exist because the port added them to `json()`/`error()`.
- `/manifest.webmanifest` reads `"name":"GeoNotes"`, confirming `ENVIRONMENT=production`.

Routing checks all pass: SPA root 200 html, deep link `/settings/some/deep/path` 200 html (fallback), `/assets/index-*.js` 200 `text/javascript` (real content type, not swallowed by the SPA), `/api/geocode?lat=999&lng=0` 400 (validation reached). That last pair together proves `run_worker_first = ["/*", "!/assets/*"]` is doing both of its jobs.

**Live configuration:**

| Thing | Value |
|---|---|
| Worker | `geonotes-worker`, version `a56c0575`, deployed by wrangler CLI |
| Custom Domain | `gnotes.vshub.app` (a **Custom Domain**, not a Route) |
| D1 | `geonotes`, `0fda6ffd-fc0e-49e1-900a-c421b64309e4` (the real production database) |
| Rate limiter | `AUTH_RATE_LIMITER`, 20 requests / 60s, **live for the first time ever** |
| Cron | `17 4 * * *` (04:17 UTC), registered, **has not fired yet** as of writing |
| Worker secrets | `AUTH_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET`, all three set and verified |
| Pages project | `geonotes` still exists, now only `geonotes-49a.pages.dev`, Git Provider `No` |
| Workers Builds | connected to `vssantoss/geonotes`, production branch `main`, **now building and deploying on push** |

**Deploys now happen on push to `main`.** Workers Builds runs `pnpm run build` then `npx wrangler deploy`. This is no longer a repo where pushing is a safe, inert act: a push to `main` is a production deploy. The active version at the time of writing is `d80de318`, deployed by a build.

---

## 1. Blocking / do before the next push

- [x] ~~**Confirm `VITE_TURNSTILE_SITEKEY` is set in the Workers Builds variables.**~~ **DONE 2026-07-20. It went wrong first, then was fixed. Worth reading, because the failure mode is subtle and will recur if the variable is ever moved.**
  - **The trap:** `.env` is gitignored, so the sitekey is not in the repo. Without it the build produces `TURNSTILE_SITEKEY = ''` (`TurnstileWidget.tsx:12` falls back to `?? ''`), the widget never renders, the client sends no token, and because `TURNSTILE_SECRET` **is** set on the Worker, `verifyTurnstile` treats the token as mandatory and throws 403. E-mail sign-in and account creation break while passkey login keeps working, which makes it easy to misdiagnose. `worker/_lib/turnstile.ts` documents this exact trap: set the sitekey at build time *before* setting the secret.
  - **What went wrong:** the variable was first added as a **Worker runtime binding**, where it sat next to `DB` and `AUTH_SECRET`. That cannot work. `import.meta.env.VITE_TURNSTILE_SITEKEY` is substituted by Vite **inside the build container**, and the result is baked into the JS the browser downloads. A runtime binding is invisible to `vite build`. The two settings pages use the same words ("Variables and secrets") for completely different things.
  - **Where it belongs:** Workers Builds -> Build configuration -> Variables and secrets. **Plaintext, not encrypted.** A Turnstile sitekey is public by design (it is the browser half; `TURNSTILE_SECRET` is the server half) and is already readable in the shipped bundle. Encrypting it would hide it from you and nobody else, and would create a second unrecoverable value.
  - **General rule:** anything prefixed `VITE_` is compiled into the browser bundle and can never be secret, however it is stored. A real secret with a `VITE_` prefix is a bug, not a storage question.
  - **Value:** `0x4AAAAAAD4sfOQnJvefAn8M`. Recoverable at any time by grepping the deployed JS, so it needs no backup.
  - **Verified fixed** by asset hash: production went `index-CAhocl1U.js` -> `index-D43w3Mfo.js` (the bad build) -> back to `index-CAhocl1U.js`, byte-identical to a local build made from `.env`. Content-hashed filenames can only match if the content matches. Direct grep of the served 495KB asset confirms one occurrence of the sitekey.
  - The stray runtime binding was afterwards deleted from the Worker. Latest version `d80de318` is live at 100% with the nine correct bindings and no `VITE_TURNSTILE_SITEKEY`.
  - **Two probes I used during this were bad; do not reuse them.** `curl -X POST /api/auth/email-request` returns `403 turnstile required` **always**, because curl cannot produce a Turnstile token, so it can never distinguish broken from working. And `curl ... | grep | head -1` on a large asset can truncate the stream and report a false negative; write the asset to a file and grep the file. The asset hash is the reliable signal.

- [ ] **Test passkey register and login on `https://gnotes.vshub.app`.** The highest-risk untested path. `AUTH_SECRET` was rotated (see section 3), and signed WebAuthn challenge tokens are the *only* thing that secret protects. If it is wrong, ceremonies fail. Existing sessions are unaffected either way, because they are opaque D1 tokens and are not signed.
  This cannot be tested anywhere but the production hostname: `RP_ID` and the CSRF origin check both name it. Failures on `workers.dev` are expected and are not a bug.

- [ ] **Test e-mail sign-in on production.** `RESEND_API_KEY` and `TURNSTILE_SECRET` were set on a brand new Worker and have never been exercised there.

---

## 2. Warnings to be aware of, no action required yet

- [ ] **Rollback is no longer instant.** The migration plan assumed a Worker *Route* sitting in front of a Pages project that still held the hostname, so reverting was "delete the route", effective in seconds. What exists instead is a **Custom Domain** on the Worker, and `gnotes.vshub.app` has been detached from Pages entirely. Reverting now means deleting the Worker custom domain and re-attaching it to Pages, which involves certificate re-provisioning and a real outage window. This is the correct end state and not a mistake to undo, but do not go looking for an instant revert that no longer exists. It raises the stakes on the two tests in section 1.

- [ ] **The cron fires at 04:17 UTC and does something irreversible.** `purgeExpiredDeletedAccounts` permanently deletes any account past its 30-day deletion window, across 6 tables. It is idempotent and correct, and this is the whole point of the migration, but it is the first time it has ever run on a guaranteed schedule rather than opportunistically. Watch the first run with `wrangler tail`. A clean no-op is the expected result.

- [ ] **The rate limiter is enforcing for the first time.** `worker/_lib/rate-limit.ts` was written against a binding Pages could not provide, so its `if (!env.AUTH_RATE_LIMITER) return` guard short-circuited every call for the entire Pages era. That guard now stops firing and 20 requests / 60s is actually enforced on auth routes. Untested in production by definition. If auth starts 429ing unexpectedly, this is why.
  Note it is per-colo and eventually consistent, so an attacker spread across colos gets `limit x colos`. It is a cheap inner layer that fails fast before D1, **not** a replacement for the zone WAF rule. Do not delete the WAF rule as now-redundant.

- [ ] **`geonotes-49a.pages.dev` still reaches production D1.** The Pages deployment is still live and bound to the same database. Same code, same rows, so not a correctness problem, but it is a second public path to your real data, not a sandbox.

---

## 3. Secrets

- [ ] **Back up `AUTH_SECRET` to a password manager. `.dev.vars` line 4 is the only copy.**
  The original production value was **unrecoverable**: `~/.bash_history:1804-1806` shows it was generated with `openssl rand -base64 32` and pasted into an interactive `wrangler pages secret put` prompt, so the value was never written to disk. History stores the command, never the output or the stdin.
  A fresh one was generated on 2026-07-19 and set on **both** Pages production and the Worker (piped from `.dev.vars`, so they are byte-identical rather than hand-pasted). It now exists in exactly one place. Losing that file repeats the whole problem.
  **What the rotation actually broke: almost nothing, and less than I told you at the time.** I said passkeys created under the old secret would stop working. That was wrong, and it is worth knowing why, because it changes how scared to be of this secret in future.

  `AUTH_SECRET` has exactly two call sites, both in `worker/_lib/enroll.ts`: signing and verifying the **enroll token**, a 10-minute stateless proof that an address was just verified by e-mail code. It gates attaching a passkey to an address and changing an account's e-mail. That is its entire blast radius. Rotating it means anyone holding an enroll token minted before the change gets `401 bad enroll token` and has to request a new code.

  It does **not** touch: enrolled passkeys (the credential is a public key in D1, verified against the authenticator's signature, secret not an input), WebAuthn challenges (`challenge.ts` stores them as D1 rows under a random id and deletes-on-read, so they are server state and not signed at all), or sessions (opaque D1 tokens).

  Confirmed on production 2026-07-20: passkeys created under the **old** secret on the Pages deployment log in fine against the Worker under the new one, with saved data loading correctly. Where my error came from: R3 in the migration plan said the secret "HMAC-signs challenge tokens in `challenge.ts`". True of an older design, stale since challenges moved to D1. I repeated it without rereading the file. R3 and the `enroll.ts` header comment are now both corrected.

- [ ] **Note that local dev now runs with the production `AUTH_SECRET`,** since it is the same value in `.dev.vars`. Acceptable here, worth remembering.

- [ ] `RESEND_API_KEY` and `TURNSTILE_SECRET` were **not** rotated. Same values as before, now on both deployments.

---

## 4. Workers Builds configuration

The connection is now live and has deployed to production twice (once broken, once fixed). Build command `pnpm run build`, deploy command `npx wrangler deploy`, production branch `main`, watch paths `*`.

- [x] ~~First build exercised.~~ **DONE 2026-07-20.** It shipped a broken bundle on the first run, for the sitekey reason in section 1. Fixed and reverified.

- [ ] **Remember that a CLI `pnpm run deploy` and a build deploy can disagree.** `wrangler deploy` sets the Worker's bindings from `wrangler.toml`, so anything added by hand in the dashboard and not present in that file is wiped on the next CLI deploy. That is how the stray `VITE_TURNSTILE_SITEKEY` runtime binding would have vanished on its own. Treat `wrangler.toml` as the source of truth for runtime config, and the Workers Builds variables as the source of truth for build-time config.

- [ ] **Decide whether non-production branch builds should stay enabled.** They are currently on, with build watch paths `*`, so *every push to any branch* runs `npx wrangler versions upload`. Those preview versions bind the **same production `database_id`**, and each gets a publicly reachable preview URL pointing at live data. That is the `pages.dev` parallel-path hazard again, but one per branch and created automatically. Either disable non-production builds or accept it knowingly.

- [ ] **Consider adding tests to the build command. This matters more now that a push deploys.** It is currently `pnpm run build`, with deploy `npx wrangler deploy`. `pnpm run build` runs `tsc -b`, so typecheck is covered, but **nothing runs the 135 tests or the lint gate**. A push to `main` deploys whatever compiles. The first automated build proved the point by shipping a broken bundle straight to production. Candidate: `pnpm run lint && pnpm run build`. Note the integration tests need a built `dist/` and boot a real Worker, so wiring the full suite into a CI build needs thought rather than being dropped in.

- [ ] Build cache is disabled. Only costs build time. Enable if builds get slow.

---

## 5. Documentation fixes

- [ ] **`pnpm deploy` is wrong everywhere it appears. The working command is `pnpm run deploy`.** `deploy` is a built-in pnpm subcommand, so the bare form fails with `ERR_PNPM_CANNOT_DEPLOY: A deploy is only possible from inside a workspace`. Occurrences to fix: `AGENTS.md:9`, `README.md:53`, `TODO.md:19`, `docs/2026-07-19.-.Workers.Migration.md:106`.

- [ ] **Update `TODO.md`'s cutover section to the actual end state.** It still describes a Worker Route and a Pages project holding the hostname. Steps 7 and most of 11 were done together via Custom Domain.

- [ ] **Record that every `wrangler` command needs the token first:** `set -a; . ~/dev/.cloudflare-token.env; set +a`. Without it wrangler tries to open a browser to log in, which does not work under WSL. Already noted at the top of `TODO.md`.

---

## 6. Verification that only you can do (browser work)

- [x] ~~PWA install label on **Android**: production must read "GeoNotes", staging "GeoNotes Dev".~~ **DONE 2026-07-20, both correct.**
- [ ] PWA install label on **iOS**, same check. This is the one thing no test can cover, and it is exactly what silently broke once already when assets bypassed the Worker.
- [ ] **An existing session is still signed in after the cutover. This one expires as a question.** Sessions live seven days (`session.ts:6`), so once every pre-cutover session has aged out there is nothing left to test and the check can never be answered. If you have not already confirmed it on a device you had signed in before 2026-07-19, close this as untestable rather than leaving it open.
- [x] ~~Sync, session revoke, and account-deletion request all still work on production.~~ **DONE 2026-07-20, all three working.** If the deletion request was left standing on a real account, note that it is a 30-day grace mark, not an immediate delete, and that signing in cancels it: `createSession` clears `deletion_requested_at` on every successful new session (`session.ts`). So an account used for testing this un-marks itself the next time you log in.
- [ ] Watch `wrangler tail` for 500s during the above. Largely overtaken now that the flows are confirmed working; useful during the cron's first runs instead.
- [x] ~~**The Turnstile widget actually renders on the sign-in screen.**~~ **DONE 2026-07-20, working.** This closes out section 1. Worth keeping the note on why it needed a human: `curl` cannot produce a Turnstile token, so it always sees `403 turnstile required` whether the widget works or not. Only a real browser settles it.

- [x] ~~E-mail sign-in end to end.~~ **DONE 2026-07-20, working.**

- [x] ~~Passkey register and login on production.~~ **DONE 2026-07-20, working**, including passkeys enrolled under the *old* `AUTH_SECRET` on Pages. See section 3 for why that is expected rather than surprising.

---

## 7. Code follow-ups, not urgent

- [ ] **Fix the three react-hooks findings currently downgraded to warnings.** Tracked in detail in `TODO.md`. `EditorScreen.tsx:60` (writes a ref during render) is the one that actually matters; the two settings sections are the ordinary load-on-mount pattern plus a missing `reload` dependency. Revert the `warn` downgrade in `eslint.config.js` once they are fixed, otherwise it quietly becomes permanent and the next real violation slips through.

- [ ] **TypeScript is pinned to 6.0.3, down from 7.0.2.** typescript-eslint hard-refuses to run on TypeScript 7, so type-aware linting and TS 7 cannot coexist today. Check typescript-eslint's peer range before bumping TypeScript again, or linting silently stops being type-aware.

- [ ] **Retire the Pages project** once the soak looks good: delete `geonotes`. This closes the parallel path to production D1 in section 2.

- [ ] **Client-side sync engine tests** for `src/lib/sync.ts` (312 lines) were scoped and not written. The valuable one is the outbox `owner` hash invariant that prevents uploading a previous account's unsynced notes after an account switch. Needs `fake-indexeddb` for Dexie.

---

## Reference

```sh
# every wrangler command needs this first
set -a; . ~/dev/.cloudflare-token.env; set +a

pnpm run deploy                  # build + wrangler deploy (NOT `pnpm deploy`)
pnpm exec wrangler tail          # live logs, incl. the cron run
pnpm exec wrangler secret list   # worker secrets
pnpm run lint && pnpm run typecheck && pnpm run build && pnpm test

# confirm who is serving production (Worker gives 404 text/plain, Pages gives 200 html)
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://gnotes.vshub.app/api/nope
```
