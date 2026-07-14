# GeoNotesClaude

## Production / build

- Production URL: https://gnotes.vshub.app
- Default Pages production URL: https://geonotes-49a.pages.dev
- Cloudflare Pages project: `geonotes` (its default `.pages.dev` subdomain is `geonotes-49a`, which is not the project name).
- WebAuthn is scoped to `gnotes.vshub.app`; test passkey registration and login through the production custom domain, not the `pages.dev` URL.
- Local preview server: `wrangler pages dev dist` on port **8788** (`/srv` nginx + cloudflared tunnel route here).
- Local preview and Cloudflare Pages serve the **built** `dist/` folder and do NOT rebuild on source changes. After editing source, run `pnpm build`; to update production, run `pnpm wrangler pages deploy dist --project-name=geonotes`.
- The sibling project GeoNotesGPT runs its own wrangler on port 8791. Don't confuse the two.

## Verification

- After implementing, run all testing that does not require spinning up a browser: the test suite, typecheck, build, and any API or function-level checks.
