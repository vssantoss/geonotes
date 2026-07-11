// Renders the PWA icon PNG set from the SVG sources into public/.
// Run with: node scripts/generate-icons.mjs

import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', 'public')
const rounded = path.join(publicDir, 'favicon.svg')
const fullbleed = path.join(here, 'icon-fullbleed.svg')

/** [source svg, output name, size] for every icon the manifest references. */
const outputs = [
  [rounded, 'pwa-192x192.png', 192],
  [rounded, 'pwa-512x512.png', 512],
  // Maskable icons must fill the whole square; the OS applies its own mask.
  [fullbleed, 'maskable-icon-512x512.png', 512],
  [fullbleed, 'apple-touch-icon-180x180.png', 180],
]

for (const [src, name, size] of outputs) {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(path.join(publicDir, name))
  console.log(`generated ${name}`)
}
