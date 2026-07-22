# TODO Android (Capacitor)

The Android build wraps the existing web app in a Capacitor native shell in **bundled mode**: `vite build` emits `dist/`, Capacitor copies it into the native project, and the app runs from the `capacitor://localhost` origin (fully offline, ships the assets).

Work is split into two phases:

- **Phase 1** installs the toolchain and gets the app, unchanged and with auth broken, running on a real phone and (if possible) an emulator. Reaching the end of phase 1 proves we have everything needed to build, deploy, and test the Android app.
- **Phase 2** is the code refactor that makes the app actually work in a native webview (auth transport, passkeys, service worker, polish).

Everything in phase 1 builds inside WSL. iOS is out of scope here and will need a Mac (Xcode does not run on Windows/WSL).

Steps are checkboxes, meant to be run one at a time. Commands are inline so each step is directly runnable.

---

## Phase 1: build and deploy the current app to a device (errors expected)

Goal: the app renders on a phone (and ideally an emulator). Login/sync will fail at `capacitor://localhost`; that is the expected end state of phase 1, not a bug to chase.

### 1a. Build toolchain (WSL)

- [x] Install JDK 17: `sudo apt install openjdk-17-jdk` (installed: OpenJDK 17.0.19)
- [x] Verify Java is 17: `java -version`
- [x] Create the SDK directory (`~/Android/sdk`)
- [x] Download the Android command-line tools zip (Linux) into `~/Android/sdk`
- [x] Unzip it so the tools land at `~/Android/sdk/cmdline-tools/latest/`
- [x] Add to `~/.bashrc`: `ANDROID_HOME=$HOME/Android/sdk` + `cmdline-tools/latest/bin`, `platform-tools`, `emulator` on `PATH`
- [x] Accept all SDK licenses: `yes | sdkmanager --licenses`
- [x] Install platform-tools (the `adb` client): `sdkmanager "platform-tools"`
- [x] Install build-tools: `sdkmanager "build-tools;35.0.0"`
- [x] Install the platform: `sdkmanager "platforms;android-35"`
- [x] Verify adb runs and note the version: **adb `37.0.0-14910828` (1.0.41)** — the Windows adb MUST match `37.0.0` (see step 1d)

Note: the emulator and system images are deliberately NOT installed in WSL. Building happens in WSL; the emulator runs on the Windows host (step 1e). WSL only needs the build SDK above plus the adb client.

### 1b. Add Capacitor and generate the Android project

- [x] Confirm the appId: `app.vshub.gnotes`
- [x] Add dependency: `@capacitor/core` (8.4.2)
- [x] Add dependency: `@capacitor/cli` (8.4.2, dev)
- [x] Add dependency: `@capacitor/android` (8.4.2)
- [x] Init Capacitor: `pnpm exec cap init GeoNotes app.vshub.gnotes --web-dir dist`
- [x] Review the generated `capacitor.config.ts` (appId/appName/webDir confirmed)
- [x] Build the web app so `dist/` exists: `pnpm build`
- [x] Add the Android platform: `pnpm exec cap add android` (created the committed `android/` project)
- [x] Sync web assets into the native project: `pnpm exec cap sync`
- [x] `.gitignore` policy: Capacitor's generated `android/.gitignore` already excludes build outputs; commit `android/` as-is

Note: Capacitor 8 needs **JDK 21** for the Gradle build. Installed `openjdk-21-jdk` (21.0.11) and it is now the default via update-alternatives (JDK 17 also still present). `./gradlew` picks up 21 from PATH.

### 1c. Build the APK

- [x] Build a debug APK: `cd android && ./gradlew assembleDebug` (built `android/app/build/outputs/apk/debug/app-debug.apk`, 4.3 MB)

### 1d. adb bridge (one adb server on Windows, WSL as a remote client)

The strategy: run a single adb server on the Windows host that owns both the emulator and the physical phone, and make WSL's adb a remote client of it. Then `adb devices` from WSL sees every target and `adb install` from WSL deploys to them.

- [x] Install Android Studio on the Windows host (Quail 2; bundles the emulator, system images, and Windows-side adb)
- [x] Windows platform-tools (adb) is r37, matching WSL's adb 37.0.0
- [x] WSL2 mirrored networking was already active (`wslinfo --networking-mode` = mirrored), so `localhost` is shared; no `wsl --shutdown` needed
- [x] Windows adb server running and reachable from WSL on `localhost:5037`
- [x] Pointed WSL adb at the Windows server: `export ADB_SERVER_SOCKET=tcp:localhost:5037` (persisted in `~/.bashrc`)
- [x] Verified from WSL: `adb devices` lists `emulator-5554`

### 1e. Emulator (Windows host)

- [x] In Android Studio (Windows) created an AVD (Play Store system image) and launched it
- [x] From WSL confirmed it appears: `adb devices` -> `emulator-5554`
- [x] Installed the built APK from WSL: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` -> Success
- [x] Launched it: `adb shell monkey -p app.vshub.gnotes -c android.intent.category.LAUNCHER 1` (confirm the UI renders; auth/sync failing is expected)

### 1f. Real device

- [ ] Attach the phone to the Windows adb server: USB into Windows, or Wireless debugging paired on Windows
- [ ] From WSL confirm both phone and emulator show in `adb devices`
- [ ] Install targeting a specific serial: `adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk`
- [ ] Launch and confirm the UI renders

**Phase 1 is done** when the app launches and renders on both the emulator and the device. That confirms the full build-to-device pipeline works and unblocks phase 2.

---

## Phase 2: refactor the code so the app works

Detailed rationale for the auth items is in the "Android app (Capacitor)" section moved to the bottom of this file. Do not weaken the web CSRF/cookie protections to make native work; add a separate native-aware path.

### Confirmed failure mode (measured in the emulator WebView over CDP, 2026-07-20)

Drove real `fetch` calls inside the running app's WebView. The WebView origin is **`https://localhost`** (Android Capacitor default scheme; iOS uses `capacitor://localhost`). Three distinct problems, in the order they bite:

- **A. Requests never leave the device.** `src/lib/api.ts` has `API_BASE = import.meta.env.VITE_API_URL ?? ''`, which is empty, so `fetch('/api/...')` resolves to `https://localhost/api/...`. Capacitor's local static server has no such route and **SPA-fallbacks to `index.html`**: the probe got `status 200`, `content-type: text/html`, body `<!doctype html>...`. Not a 404 or network error, a 200 with HTML, so the client's `res.json()` throws a parse error (swallowed for geocode, a generic failure for auth). This blocks everything today.
- **B. Production is behind a CORS wall.** A direct `fetch('https://gnotes.vshub.app/api/...')` from the WebView throws `TypeError: Failed to fetch`. Confirmed CORS, not connectivity: a `mode:'no-cors'` fetch returns `type:'opaque'` (reachable), the browser just blocks the readable response because the Worker sends no `Access-Control-Allow-Origin` for `https://localhost`.
- **C. Auth transport (certain from code, not yet reached because A blocks first).** `credentials:'same-origin'` will not attach the `__Host-geonotes_session` cookie cross-origin, and the Worker's `requireTrustedOrigin` + `SameSite=Strict` + `__Host-` prefix are web-origin-only.

### Fix A: point the native build at the real API

One build-time flag, `CAPACITOR_BUILD=1`, drives both differences; the new `pnpm build:native` script sets it (plus `VITE_API_URL`) and runs `cap sync android`. The default `pnpm build` (web) is unchanged.

- [x] Give the Capacitor build an absolute API base: `VITE_API_URL=https://gnotes.vshub.app` (native build only; the web build stays empty so cookies remain same-origin). Verified: `gnotes.vshub.app` is baked into the native bundle and absent from the web bundle. No source change to `api.ts` (it already reads `import.meta.env.VITE_API_URL`); only its comment was updated.
- [x] Service worker: disable the Workbox SW in the Capacitor build via `VitePWA({ disable: isNativeBuild })` in `vite.config.ts` (plugin stays in the list so `virtual:pwa-register` resolves and `registerSW()` compiles to a no-op). Verified: native `dist/` emits no `sw.js`/`workbox-*.js`; web `dist/` still does.
  - [ ] Runtime check (needs the emulator): confirm the Dexie/outbox offline path still works with the SW gone. (Deferred: exercised once login works; no regression expected since the outbox is IndexedDB, not the SW cache.)
- [x] Rebuilt + `cap sync` + reinstalled the APK, verified in the emulator WebView over CDP. Clean-install result (2026-07-21): `origin` is `https://localhost`, `navigator.serviceWorker` has **0** registrations (SW disable confirmed at runtime), the app's absolute call to `https://gnotes.vshub.app/api/*` now throws `TypeError: Failed to fetch` (CORS), and a `mode:'no-cors'` probe returns `type:'opaque'` (production reached, CORS is the sole remaining wall). The old 200-HTML SPA-fallback dead end is gone. **Fix A is done; the failure has moved to CORS (Fix B).**

Dev-only gotcha found while verifying: reinstalling the native APK *over* a prior SW-bearing build (the Phase 1 web build) leaves the old `https://localhost/sw.js` service worker registered, because the native build serves no `/sw.js` so its update check 404s and the SW lingers. `adb shell pm clear app.vshub.gnotes` (wipe app storage) clears it. This does not affect real users: a first-time native install never had that SW. Only matters when reinstalling across the web-to-native transition on the same device.

Also fixed in passing: `capacitor.config.ts` was not in any tsconfig, which broke `pnpm lint` (type-aware ESLint could not resolve it). Added it to `tsconfig.node.json`'s `include` alongside `vite.config.ts`.

### Fix B: allow the native origin at the edge (CORS)

- [x] Worker: added `worker/_lib/cors.ts`, a Hono middleware wired first on `/api/*` in `router.ts`. Allowlists exactly `https://localhost` (Android) and `capacitor://localhost` (iOS); answers the `OPTIONS` preflight directly (204 + allowed origin/methods/headers/max-age) and reflects the allowed origin (+ `Vary: Origin`) onto every `/api` response, including errors, so a 403 stays readable rather than opaque. Deliberately sends **no** `Access-Control-Allow-Credentials`: native uses a bearer token (Fix C), not the cookie, so `SameSite`, the `__Host-` prefix, and `requireTrustedOrigin` are all untouched for the web flow. 7 unit tests added.
- [x] Verified against the built Worker (curl, 2026-07-21/22): preflights from both native origins return 204 with the reflected origin; native GET/POST responses (incl. the 400 and the origin-check 403) carry the header; untrusted origins and same-origin web requests get none; `Allow-Credentials` never appears. A native POST now moves past CORS to the `requireTrustedOrigin` 403, which is the Fix C wall.
  - [ ] Live confirmation from the emulator WebView still pending: it needs the CORS Worker reachable at `gnotes.vshub.app`, i.e. a production (or staging) deploy. Not yet deployed.

### Fix C: native-aware auth transport (cookie -> bearer token)

- [x] Add a secure-storage plugin and keep the session token in Android Keystore / EncryptedSharedPreferences. Added `capacitor-secure-storage-plugin@0.13.0` (Android EncryptedSharedPreferences; peers only on `@capacitor/core >=8.0.0`, so no extra plugin deps). New `src/lib/native-session.ts` wraps it as `get/set/clearSessionToken`, each a no-op off native (`Capacitor.isNativePlatform()` false) since the web session lives in the HttpOnly cookie and JS cannot read it. `cap sync` registered the plugin and `gradlew assembleDebug` links + packages it, so the native module compiles into the app.
- [x] Refactor `apiFetch`: stop relying on the `__Host-geonotes_session` cookie; send the session token explicitly (Authorization header) when running native. `apiFetch` now reads `getSessionToken()` and, when one is stored, adds `Authorization: Bearer <token>`; `credentials: 'same-origin'` is unchanged, so on web (token always null) the request is byte-for-byte the old cookie flow. `auth.ts` stores the token returned by `passkey-login`/`passkey-register` (`setSessionToken`, before the sign-in is applied so follow-up calls can authenticate) and clears it on sign-out (`signOut`, `cancelPendingSignIn`); `sync.ts`'s `wipeLocalAccountData` clears it too, covering remote revocation.
- [x] Worker: add a native-aware, CSRF-safe auth path separate from the browser cookie flow (accept and validate the header token). `readBearerToken` added to `http.ts`; `requireUser`/`destroySession`/`currentSessionHash` now resolve the token as bearer-then-cookie (bearer used exclusively when present, so an ambient cookie is never smuggled past the origin check). `requireTrustedOrigin` skips the Origin check only for bearer requests (a token a cross-site page cannot read is CSRF-immune), leaving `SameSite=Strict`, `__Host-` and the cookie-path Origin check untouched. `passkey-login`/`passkey-register` return the raw token in the body only for native origins (`isNativeOrigin`, browser-unforgeable Origin), never to web where it stays HttpOnly. 3 tests added (1 router, 2 sync integration): a native cross-origin bearer POST with **no cookie** stores and pulls back a note (200) against real SQLite, and an unknown bearer yields 401 not 403, proving the origin gate falls for bearer requests. Full pipeline green (163 tests).
  - [~] Verify login + session + sync work end to end from the WebView. **Server side done and verified live.** Fix C was deployed out-of-band to production (`pnpm run deploy`, version `8215deee`, no merge to main). Probes against `gnotes.vshub.app` (2026-07-22) confirm the origin gate now falls for bearer requests: a native-origin (`https://localhost`) POST carrying an `Authorization: Bearer` returns **401** (bearer clears `requireTrustedOrigin`, then fails auth on the bogus token) where before Fix C it was `403 bad origin`; the same POST with no bearer, and any foreign-origin POST, still get `403 bad origin`; and no `Access-Control-Allow-Credentials` is ever sent. The debug APK (built with the Fix C client + the secure-storage plugin, `VITE_API_URL=https://gnotes.vshub.app` baked in) is ready to install. **Remaining:** the on-device passkey login -> session -> sync round-trip in the emulator WebView, blocked only on the emulator being booted (no device attached at deploy time) and a real passkey ceremony.

### Native passkeys

- [ ] Add a native passkey plugin driving Android Credential Manager
- [ ] Serve `/.well-known/assetlinks.json` from the Worker with the app signing cert SHA-256 fingerprint (Digital Asset Links for `RP_ID` = `gnotes.vshub.app`)
- [ ] Wire the native passkey assertion back into the existing `@simplewebauthn/server` verification

### Hardening + polish

- [ ] Native bot resistance (full rationale in the "Native bot resistance" part of the moved section below):
  - [ ] Do NOT render or force Turnstile in the native webview: its origin is `localhost`, which weakens the siteverify hostname signal and is finicky around Origin/Referer. Use platform attestation instead.
  - [ ] Android: obtain a Play Integrity token in the app and send it with pre-auth requests; verify server-side against Google's Play Integrity API (app package, signing cert, integrity verdicts). Needs a Google Play project + a service credential.
  - [ ] Backend: pre-auth endpoints (`email-request` first) accept EITHER a Turnstile token (web) OR a valid attestation token (native), and reject requests carrying neither. Keep the per-IP edge rate limit as the floor under both.
  - [ ] Do NOT add a "skip if native" bypass: a client-asserted native flag is trivially forgeable and reopens the abuse hole.
  - [ ] iOS (later): App Attest (hardware-bound key, assert per request), with DeviceCheck as the lighter-weight fallback.

  Reality check (verified 2026-07-20): Turnstile is ALREADY required on `email-request` in production, so this is a functional BLOCKER, not just future hardening. `worker/api/auth/email-request.ts:39` calls `verifyTurnstile`, which throws `403 "turnstile required"` whenever `TURNSTILE_SECRET` is set (`worker/_lib/turnstile.ts:36-40`), and it is set in production. Consequence: once the native app can reach the API (Fix A/B/C), its email sign-in / account-creation flow will 403 until the backend accepts a Play Integrity token as the native alternative on `email-request`. Passkey *login* does not call Turnstile (`passkey-login-options` / `passkey-login`), so a returning passkey user is unaffected; only email-code issuance (new account, email change) is gated. This is why bot resistance cannot simply be deferred to the end for anything involving account creation.
- [x] Fix the app icon: replaced Capacitor's default launcher icon with the GeoNotes mark. `assets/gen-icons.mjs` rasterises the source PNGs from `public/favicon.svg` (plus a glyph-only foreground SVG scaled into the adaptive safe zone), then `@capacitor/assets generate --android` fans them out. The generated `mipmap-anydpi-v26/ic_launcher*.xml` is edited back to the no-inset adaptive form: the tool insets both layers 16.7%, which would shrink the solid red background into a 66.6% square (transparent corners under a circular mask) and double-shrink the glyph, so the foreground SVG carries the safe-zone padding instead and the background stays full-bleed red. Orphaned Capacitor-default vector drawables (green robot foreground + its bg colour) removed. Verified on emulator: the OS-rendered round adaptive icon shows the full red circle with the glyph inside the safe zone, no transparent corners. Commit `4716fdb`. NOTE: re-running `capacitor-assets` re-adds the insets, so the XML edit must be redone after any regeneration (documented in `assets/gen-icons.mjs`).
- [ ] Polish: splash screen, status bar, hardware back button, safe-area insets
- [ ] Re-test the full auth + sync + passkey flow on a device

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
