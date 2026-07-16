import { useSyncExternalStore } from 'react'

/**
 * The non-standard `beforeinstallprompt` event (Chromium browsers). It is not in
 * the DOM lib types, so the shape the app uses is declared here.
 */
interface BeforeInstallPromptEvent extends Event {
  /** Resolves once the user accepts or dismisses the install prompt. */
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  /** Shows the browser's native install prompt. Usable once per event. */
  prompt(): Promise<void>
}

// The most recent deferred install prompt, or null when the app is not
// installable (unsupported browser, already installed, or prompt already used).
let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

/** Notifies every subscribed component that the installable state changed. */
function emit() {
  for (const listener of listeners) listener()
}

// Listen at module load, not on mount: `beforeinstallprompt` can fire before any
// component renders, so capturing it here avoids missing that single event.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress Chrome's automatic mini-infobar; the app triggers the prompt from
    // the account menu instead.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    emit()
  })
  // Once installed the prompt is spent and the option should disappear.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    emit()
  })
}

/**
 * Whether to offer the manual iOS "Add to Home Screen" hint instead of a real
 * install button. Every browser on iOS is WebKit and never fires
 * `beforeinstallprompt`, so no programmatic prompt is possible there and the
 * user must install through the Share menu. Returns true only on iOS while the
 * app is still running in a browser tab; false on other platforms (they get the
 * real prompt) and once the app is already installed (launched standalone).
 *
 * @returns true when the iOS manual-install instructions should be offered.
 */
export function isIosInstallAvailable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPhone/iPod, plus iPadOS which reports as "Macintosh" but is touch-capable.
  const isIos =
    /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  if (!isIos) return false
  // Already installed and opened from the home screen: nothing left to install.
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  return !standalone
}

/**
 * Subscribes a component to installable-state changes.
 *
 * @param callback - re-render trigger from useSyncExternalStore.
 * @returns an unsubscribe function.
 */
function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** @returns whether an install prompt is currently available. */
function getSnapshot(): boolean {
  return deferredPrompt !== null
}

/** Server/prerender snapshot: never installable without a live window. */
function getServerSnapshot(): boolean {
  return false
}

/**
 * Exposes the app's PWA installability and a trigger for the native install
 * prompt. The menu shows the install option only while `canInstall` is true.
 *
 * @returns `canInstall` (whether to offer installation) and `promptInstall`
 *          (shows the browser prompt; a no-op when nothing is deferred).
 */
export function usePwaInstall(): { canInstall: boolean; promptInstall: () => Promise<void> } {
  const canInstall = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  /** Shows the deferred install prompt, then clears it (a prompt is single-use). */
  const promptInstall = async () => {
    const prompt = deferredPrompt
    if (!prompt) return
    await prompt.prompt()
    // Wait for the choice so a dismissal is fully resolved before clearing.
    await prompt.userChoice
    deferredPrompt = null
    emit()
  }

  return { canInstall, promptInstall }
}
