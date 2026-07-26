import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * The native SystemBars plugin (implemented in
 * android/app/src/main/java/app/vshub/gnotes/SystemBarsPlugin.java and
 * registered in MainActivity). It sets whether the system draws the status and
 * navigation bar icons light or dark.
 */
interface SystemBarsPlugin {
  setAppearance(options: { dark: boolean }): Promise<void>
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

/**
 * Keeps the system bar icons legible against the app's own background.
 *
 * The native app runs edge-to-edge, so the page shows through the status and
 * navigation bars while the clock, battery and signal icons stay the system's
 * to draw. Nothing tells it which appearance the app settled on (the stored
 * preference can disagree with the system's dark mode), so on the light theme
 * the icons stay white on a near-white background and all but disappear.
 *
 * No-op on the web, where the browser handles its own chrome from the
 * theme-color meta tag. Failures are swallowed: this is cosmetic, and an older
 * build of the app without the native plugin should not throw here.
 *
 * @param dark - whether the app is currently showing its dark appearance.
 */
export function setSystemBarsAppearance(dark: boolean): void {
  if (!Capacitor.isNativePlatform()) return
  void SystemBars.setAppearance({ dark }).catch(() => {
    /* cosmetic only, and unavailable on a native build without the plugin */
  })
}
