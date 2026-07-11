import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'GeoNotes',
        short_name: 'GeoNotes',
        description: 'Short notes tied to the places where they matter.',
        theme_color: '#f4f2ee',
        background_color: '#f4f2ee',
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
  ],
  server: {
    // Forward API calls to `wrangler pages dev` during development so
    // `pnpm dev` (fast HMR) and the Functions backend can run side by side.
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
})
