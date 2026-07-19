# GeoNotesClaude

## Production / build

- Production URL: https://gnotes.vshub.app
- Cloudflare Worker: `geonotes-worker`. It serves both the API and the built SPA (static assets binding). The name deliberately differs from the old Pages project `geonotes`, which stays deployed during the cutover so rollback is just removing the Worker route.
- WebAuthn is scoped to `gnotes.vshub.app`; test passkey registration and login through the production custom domain. Passkeys and e-mail sign-in cannot work on the `workers.dev` subdomain, since `RP_ID` and the CSRF origin check both name the production host.
- Local preview server: `wrangler dev` on port **8788** via `pnpm preview` (`/srv` nginx + cloudflared tunnel route here, so the `--ip 0.0.0.0` in that script is load-bearing).
- Local preview and the deployed Worker serve the **built** `dist/` folder and do NOT rebuild on source changes. After editing source, run `pnpm build`; to update production, run `pnpm deploy`.
- URLs are declared in `worker/router.ts`, not by file paths. Adding a file under `worker/api/` does nothing until it is registered there.
- The sibling project GeoNotesGPT runs its own wrangler on port 8791. Don't confuse the two.

## Verification

- After implementing, run all testing that does not require spinning up a browser: the test suite, typecheck, build, and any API or function-level checks.
- Run `pnpm build` **before** `pnpm test`. The `integration` vitest project boots a real local Worker from `wrangler.toml` and serves the built `dist/`, so a stale or missing build makes those tests fail or test the wrong thing. `pnpm vitest run --project unit` skips them when you only need the fast suite.
