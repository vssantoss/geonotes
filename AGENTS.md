# GeoNotesClaude

## Staging / build

- Staging URL: https://geoclaude.vsantos.net
- Dev server: `wrangler pages dev dist` on port **8788** (`/srv` nginx + cloudflared tunnel route here).
- It serves the **built** `dist/` folder and does NOT rebuild on source changes. After editing source, run `pnpm build` for staging to reflect it.
- The sibling project GeoNotesGPT runs its own wrangler on port 8791. Don't confuse the two.

## Verification

- Do NOT visually check or test the app after implementing. The user is responsible for visual testing.
- If a specific test needs to be done, note it after finishing the implementation and let the user run it.
