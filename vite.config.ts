import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// A native (Capacitor) build ships the bundle inside the app and loads it from
// the `https://localhost` webview origin, so it must talk to the deployed API
// cross-origin (VITE_API_URL, set by the `build:native` script) and must NOT
// register a service worker: the app shell is already on-device as native
// files, so the SW adds no offline value and only risks serving stale assets
// across app updates. The default web build keeps both (same-origin API +
// installable PWA). One flag drives both differences.
const isNativeBuild = process.env.CAPACITOR_BUILD === '1'

/**
 * A service worker that removes itself.
 *
 * An APK built without CAPACITOR_BUILD=1 ships the PWA service worker, which
 * then registers inside the webview and precaches the app shell. From that
 * point the webview serves its own cached copy of the bundle and the assets in
 * the APK are never read, so a corrected build cannot fix the install: its code
 * does not run. Reinstalling does not help either, since the registration and
 * its caches live in the app's webview data and survive it.
 *
 * The one thing such an install still does is refetch /sw.js on every load, so
 * that is the only channel left to reach it. Capacitor answers a missing
 * /sw.js with the SPA fallback, whose HTML content type the browser refuses as
 * a worker script, which is why it never expires on its own.
 */
const SW_KILL_SWITCH = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
    await self.registration.unregister()
    // Reload every open window so it comes back uncontrolled, reading the real
    // bundle from the app's assets instead of the cache just deleted.
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.navigate(client.url)
    }
  })())
})
`

/**
 * Emits the self-removing service worker above into a native build, which
 * otherwise ships no /sw.js at all.
 *
 * Keep this even once every device is healed: an install that has not been
 * launched since is still waiting for it, and it costs a few hundred bytes
 * that a correctly built app never requests.
 *
 * @returns the Vite plugin that writes sw.js at build time.
 */
function serviceWorkerKillSwitch(): Plugin {
  return {
    name: 'geonotes:sw-kill-switch',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: SW_KILL_SWITCH })
    },
  }
}

export default defineConfig({
  resolve: {
    // "@/..." import alias used by shadcn/ui components (mirrors tsconfig paths).
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Disabled for the native build (see isNativeBuild above). The plugin
      // stays in the list so `virtual:pwa-register` still resolves and
      // `registerSW()` in main.tsx compiles to a no-op instead of failing.
      disable: isNativeBuild,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'GeoNotes',
        short_name: 'GeoNotes',
        description: 'Short notes tied to the places where they matter.',
        theme_color: '#f1f2eb',
        // Matches the logo's red rounded-square so the Android PWA splash
        // screen (which fills with background_color behind the icon) is the
        // same red as the mark rather than a white field.
        background_color: '#b91c1c',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // API calls must never be served from the SW cache; the app's own
        // outbox in IndexedDB is the single source of truth for offline sync.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
    // Native only: the web build's sw.js is the real one, generated above.
    ...(isNativeBuild ? [serviceWorkerKillSwitch()] : []),
  ],
  server: {
    // Forward API calls to the `wrangler dev` server (`pnpm preview`, port
    // 8788) during development so `pnpm dev` (fast HMR) and the Worker backend
    // can run side by side.
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
})
