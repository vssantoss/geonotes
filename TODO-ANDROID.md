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

- [ ] Service worker: disable the Workbox SW in the Capacitor build (a SW controlling `capacitor://localhost` fights the native webview) and confirm Dexie/outbox offline still works
- [ ] Add a secure-storage plugin and keep the session token in Android Keystore / EncryptedSharedPreferences
- [ ] Refactor auth transport: stop relying on the `__Host-geonotes_session` cookie; send the session token explicitly (Authorization header)
- [ ] Worker: add a native-aware, CSRF-safe auth path separate from the browser cookie flow (accept the header token)
- [ ] Worker: allow the Capacitor origin for `/api/*` (CORS) without loosening `SameSite`, the `__Host-` prefix, or `requireTrustedOrigin` for the web flow
- [ ] Verify every `/api/*` call works cross-origin from `capacitor://localhost`
- [ ] Add a native passkey plugin driving Android Credential Manager
- [ ] Serve `/.well-known/assetlinks.json` from the Worker with the app signing cert SHA-256 fingerprint (Digital Asset Links for `RP_ID` = `gnotes.vshub.app`)
- [ ] Wire the native passkey assertion back into the existing `@simplewebauthn/server` verification
- [ ] Native bot resistance: add Play Integrity on the pre-auth endpoints (see the moved notes) so native supplies a proof-of-humanity token alongside web Turnstile
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
