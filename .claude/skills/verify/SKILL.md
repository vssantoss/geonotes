---
name: verify
description: How to build, launch and drive GeoNotes for runtime verification of UI changes.
---

# Verifying GeoNotes changes at runtime

## Launch

`pnpm dev --port 5199 --strictPort` starts Vite only. There is no API on this server, so `/api/*` calls fail; the app tolerates that (offline-first), but signed-in sync shows the "session expired" notice. `pnpm preview` (wrangler pages dev on `dist/`) serves the functions too if the API matters.

## Drive (headless browser)

No Playwright in the repo, but browsers are cached in `~/.cache/ms-playwright/` (chromium_headless_shell-1228). Install `playwright-core` in a temp dir with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and launch with `executablePath` pointing at the cached `chrome-headless-shell`. Grant geolocation permission and a fake position in the browser context or the app sits on "Getting your location".

## Gotchas

- Simulate a signed-in session by writing `{key: 'sessionToken', value: ...}` and `{key: 'userEmail', value: ...}` rows into the `kv` store of the `geonotes` IndexedDB database, then **reload the page**: Dexie's `useLiveQuery` does not observe raw IndexedDB writes made outside Dexie.
- Passkey (WebAuthn) ceremonies cannot complete headless; the auth screen's failure path shows "Back"/"Not now" buttons to return to the main screen.
