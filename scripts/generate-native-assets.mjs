// Build the @capacitor/assets source images from the GeoNotes brand mark, into
// assets/ where @capacitor/assets reads them. Run with:
// `node scripts/generate-native-assets.mjs`. Companion to generate-icons.mjs,
// which produces the PWA icon set for the web build instead.
//
// NOTE: after `capacitor-assets generate --android`, the generated
// mipmap-anydpi-v26/ic_launcher*.xml must be hand-edited back to the no-inset
// form (the tool insets both layers, which shrinks the solid red background into
// a 66.6% square). Do not re-run the tool without redoing that.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Resolved from this file, not the working directory, so the script runs from
// anywhere (the same convention as generate-icons.mjs).
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const assetsDir = path.join(root, 'assets')
const favicon = path.join(root, 'public', 'favicon.svg')

const RED = '#b91c1c' // brand red (favicon rect + manifest background_color)
mkdirSync(assetsDir, { recursive: true })

// Adaptive foreground: the glyph on transparency (red comes from the background
// layer). High render density then downscale keeps the vector edges crisp.
await sharp(path.join(assetsDir, 'icon-foreground.svg'), { density: 384 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(assetsDir, 'icon-foreground.png'))

// Adaptive background: solid brand red.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: RED } })
  .png()
  .toFile(path.join(assetsDir, 'icon-background.png'))

// Legacy / non-adaptive icon: the full mark (red rounded square + glyph).
await sharp(favicon, { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile(path.join(assetsDir, 'icon-only.png'))

// Splash: the mark centred on a red field. The favicon's own rounded square is
// the same red, so it blends into the field and only the glyph reads. Light and
// dark are the same image, so it is encoded once and written twice rather than
// re-running a 2732x2732 composite for each.
const mark = await sharp(favicon, { density: 512 }).resize(1000, 1000).png().toBuffer()
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 4, background: RED } })
  .composite([{ input: mark, gravity: 'center' }])
  .png()
  .toBuffer()
for (const name of ['splash.png', 'splash-dark.png']) {
  writeFileSync(path.join(assetsDir, name), splash)
}

console.log('wrote assets/{icon-foreground,icon-background,icon-only,splash,splash-dark}.png')
