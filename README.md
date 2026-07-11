# GeoNotes

Offline-first PWA for short formatted notes tied to precise physical locations. Built with React + Vite + TypeScript on the frontend and Cloudflare Pages Functions + D1 on the backend, and architected so the same codebase can later be packaged with Capacitor for iOS/Android.

## Features

- On open, instantly shows the notes saved at your current location. All notes are listed while GPS acquires, then sorted by distance with "here" notes highlighted.

- High-accuracy GPS with live precision readout. Polling stops the moment a precise lock is achieved (accuracy <= 10 m, or best fix after a 5 s grace period once accuracy reaches <= 50 m) to save battery.

- Notes are text only (max 512 chars, live counter) plus `**bold**` formatting. The location is captured when you tap "+" and can never be changed afterward; only the text is editable.

- Deletes are hard deletes. There is no trash and no recovery.

- Auth is email plus passkey, zero passwords. First sign-in uses a 6-digit email code (sign-up is implicit), after which the app offers passkey enrollment.

- Fully offline capable: read, create, edit and delete notes offline; changes sync automatically on reconnect. Reverse-geocoded addresses (Nominatim) are backfilled during sync for notes created offline.

- Localized in English, Spanish and Portuguese (auto-detected). Light theme is a warm off-white, dark theme follows the system.

## Sync design (D1 free-tier friendly)

The app only ever syncs what changed. Local mutations go into an outbox (one entry per note), flushed as a single `POST /api/sync` that the server applies with one `db.batch()` call. Pulls are cursor-based deltas stamped with a server-side `synced_at` column, so an unchanged account costs an empty response and zero writes. Deletions propagate through a compact ID-only `deleted_notes` log that is pruned after 30 days; clients with a cursor older than 25 days fall back to one full pull. Conflicts resolve last-write-wins on the client `updatedAt`.

## Development

```sh
pnpm install
pnpm wrangler d1 migrations apply geonotes --local
pnpm build
pnpm preview            # wrangler pages dev dist, app + API + local D1 on :8788
```

For fast frontend iteration, run `pnpm dev` (Vite on :5173, proxies /api to :8788) alongside `pnpm preview`.

`.dev.vars` holds local backend config; copy `.dev.vars.example` if it is missing. With `ENVIRONMENT=dev` the email sender is a stub: the sign-in code is printed to the wrangler console and echoed in the API response, and the auth screen prefills it.

```sh
pnpm test               # vitest unit tests (bold parser, GPS lock machine, geo math)
pnpm typecheck          # tsc -b across app, node and functions configs
```

## Deploying to Cloudflare

1. Create the database: `pnpm wrangler d1 create geonotes`, then paste the returned `database_id` into `wrangler.toml`.

2. Apply migrations remotely: `pnpm wrangler d1 migrations apply geonotes --remote`.

3. Set the auth secret: `pnpm wrangler pages secret put AUTH_SECRET` (any long random string; it signs WebAuthn challenge tokens).

4. Check `[vars]` in `wrangler.toml`: `RP_ID` and `ORIGIN` must match the production hostname, `ENVIRONMENT` must not be `dev` in production.

5. Deploy: `pnpm build && pnpm wrangler pages deploy dist`.

Email delivery is stubbed behind the `EmailSender` interface in `functions/_lib/email.ts`. Wire a real provider (MailChannels, Resend, etc.) there before production use, otherwise sign-in codes are only visible in logs.

## Project layout

- `src/` frontend: screens, components, hooks, and `lib/` (Dexie db, sync engine, GPS lock machine, i18n, bold parser).
- `functions/api/` Cloudflare Pages Functions: `/api/sync`, `/api/geocode` (cached Nominatim proxy) and `/api/auth/*` (passkeys + email codes).
- `shared/` types shared between frontend and functions.
- `migrations/` D1 SQL migrations.

Reverse geocoding data is © OpenStreetMap contributors, attributed in the app footer.
