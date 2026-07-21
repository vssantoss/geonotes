# GeoNotesClaude

## Production / build

- Production URL: https://gnotes.vshub.app
- Cloudflare Worker: `geonotes-worker`. It serves both the API and the built SPA (static assets binding). The name differs from the old Pages project `geonotes`, which existed only for the cutover and has since been deleted from Cloudflare.
- **Deploys happen on push.** The GitHub repo is connected to the `geonotes-worker` Workers project, so pushing to `main` builds and deploys production. Cloudflare runs the build itself: `dist/` is gitignored and never committed. Nothing reaches production from a feature branch, and a push to `main` is a production release, so treat it as one.
- `pnpm run deploy` still works and pushes the local `dist/` straight to the Worker, bypassing the repo. Use it only for an out-of-band deploy, and rebuild first, since it ships whatever `dist/` currently holds. It must be `pnpm run deploy`: `deploy` is a built-in pnpm subcommand, so a bare `pnpm deploy` fails with `ERR_PNPM_CANNOT_DEPLOY`.
- WebAuthn is scoped to `gnotes.vshub.app`; test passkey registration and login through the production custom domain. Passkeys and e-mail sign-in cannot work on the `workers.dev` subdomain, since `RP_ID` and the CSRF origin check both name the production host.
- Local preview server: `wrangler dev` on port **8788** via `pnpm preview` (`/srv` nginx + cloudflared tunnel route here, so the `--ip 0.0.0.0` in that script is load-bearing).
- Local preview serves the **built** `dist/` folder and does NOT rebuild on source changes. After editing source, run `pnpm build` or staging keeps serving the previous build.
- URLs are declared in `worker/router.ts`, not by file paths. Adding a file under `worker/api/` does nothing until it is registered there.
- The sibling project GeoNotesGPT runs its own wrangler on port 8791. Don't confuse the two.

## Verification

- After implementing, run all testing that does not require spinning up a browser: the test suite, typecheck, build, and any API or function-level checks.
- The pipeline is `pnpm lint && pnpm typecheck && pnpm build && pnpm test`.
- Run `pnpm build` **before** `pnpm test`. The `integration` vitest project boots a real local Worker from `wrangler.toml` and serves the built `dist/`, so a stale or missing build makes those tests fail or test the wrong thing. `pnpm vitest run --project unit` skips them when you only need the fast suite.

## Lint

`pnpm lint` runs ESLint with `typescript-eslint`'s type-checked rules, resolving each file to the tsconfig project that already owns it (app / node / worker / test) via `projectService`.

**TypeScript is pinned to 6.0.3 for this.** typescript-eslint refuses to run on TypeScript 7 (an explicit version guard, not a soft warning), so upgrading TypeScript means dropping type-aware linting. Do not bump it without checking typescript-eslint's peer range first.

`no-unnecessary-type-assertion` and `require-await` are off for `worker/`, `shared/` and `test/`. Both misfire there: the Workers and Hono APIs are generic with a default that infers from the assertion itself, and the async stubs are async because the interface they implement is.

## Tests

Two vitest projects, split by cost rather than by runtime (`vitest.config.ts`):

- **`unit`** (`src/**`, `worker/**/*.test.ts`): pure logic and the Hono app driven in-process via `app.request()` with a fake `DB`. Sub-second.
- **`integration`** (`test/**/*.integration.test.ts`): boots real infrastructure. `routing.integration.test.ts` starts a local Worker from `wrangler.toml` so the static-assets router is in front of it; the rest get a throwaway D1 database with the real `migrations/` applied, via `test/support/d1.ts`.

Anything whose correctness lives in SQL belongs in the `integration` project. The sync engine's last-write-wins, immutable coordinates and per-user ownership are all WHERE clauses in one conditional upsert, and the e-mail-code abuse limits are all ON CONFLICT / CASE logic. A fake `DB.prepare` can only assert which strings were passed to it, which tests none of that.

`test/` has its own `tsconfig.test.json` because those files run in Node and need `@types/node`. `tsconfig.worker.json` deliberately does **not** have Node types, so it stays the check that stops worker code reaching for a Node builtin that would not exist at the edge.
