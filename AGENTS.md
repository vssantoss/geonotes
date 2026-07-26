# GeoNotesClaude

Only what is costly to work out from the repo itself. Anything discoverable by reading a config or a script is deliberately not here.

## Deploying

- **Pushing to `main` is a production release.** The GitHub repo is connected to the `geonotes-worker` Workers project, and Cloudflare builds and deploys on push. Nothing reaches production from a feature branch.
- `pnpm run deploy` ships the local `dist/` straight to the Worker, bypassing the repo, for an out-of-band release. It must be `run`: bare `pnpm deploy` hits pnpm's own built-in subcommand and fails.
- Passkeys and e-mail sign-in only work on `https://gnotes.vshub.app`, since `RP_ID` and the CSRF origin check both name it. Testing them against the `workers.dev` subdomain is wasted effort.

## Building

- **The Android APK must be built with `pnpm build:native`**, never a plain `pnpm build` plus `cap sync`. Those env vars are baked into the bundle: without `VITE_API_URL` every request inside the WebView goes to `https://localhost`, so the app launches and looks fine while every authenticated screen fails. Then `cd android && ./gradlew assembleDebug`.
- Both flavours write to the same `dist/`, so follow a `build:native` with a plain `pnpm build` to leave it web-flavoured.
- Run `pnpm build` **before** `pnpm test`. The `integration` project serves the built `dist/`, so a stale or missing build tests the wrong thing. `pnpm vitest run --project unit` skips those.
- `pnpm preview` serves the built `dist/` and does not rebuild on source changes. Its `--ip 0.0.0.0` is load-bearing: the `/srv` nginx and cloudflared tunnel route to it. The sibling project GeoNotesGPT owns port 8791.

## Constraints

- **TypeScript is pinned to 6.0.3.** typescript-eslint refuses to run on TypeScript 7 (a hard version guard, not a warning), so bumping it means losing type-aware linting. Check its peer range first.
- Anything whose correctness lives in SQL belongs in the `integration` vitest project. Last-write-wins, immutable coordinates and per-user ownership are all WHERE clauses in a single conditional upsert, and a fake `DB.prepare` can only assert which strings were passed to it.
