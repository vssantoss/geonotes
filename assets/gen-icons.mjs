// Build the @capacitor/assets source images from the GeoNotes brand mark. Run
// from the project root (`node assets/gen-icons.mjs`); outputs the five PNGs
// @capacitor/assets reads. NOTE: after `capacitor-assets generate --android`,
// the generated mipmap-anydpi-v26/ic_launcher*.xml must be hand-edited back to
// the no-inset form (the tool insets both layers, which shrinks the solid red
// background into a 66.6% square). Do not re-run the tool without redoing that.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const RED = '#b91c1c' // brand red (favicon rect + manifest background_color)
mkdirSync('assets', { recursive: true })

// Adaptive foreground: the glyph on transparency (red comes from the background
// layer). High render density then downscale keeps the vector edges crisp.
await sharp('assets/icon-foreground.svg', { density: 384 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('assets/icon-foreground.png')

// Adaptive background: solid brand red.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: RED } })
  .png()
  .toFile('assets/icon-background.png')

// Legacy / non-adaptive icon: the full mark (red rounded square + glyph).
await sharp('public/favicon.svg', { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile('assets/icon-only.png')

// Splash: the mark centred on a red field. The favicon's own rounded square is
// the same red, so it blends into the field and only the glyph reads.
const mark = await sharp('public/favicon.svg', { density: 512 }).resize(1000, 1000).png().toBuffer()
for (const out of ['assets/splash.png', 'assets/splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: RED } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(out)
}

console.log('wrote assets/{icon-foreground,icon-background,icon-only,splash,splash-dark}.png')
