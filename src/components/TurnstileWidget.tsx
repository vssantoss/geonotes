import { useEffect, useRef } from 'react'

/** Cloudflare's widget script; renders the challenge into a supplied element. */
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/**
 * Public Turnstile sitekey, baked in at build time. Empty when unconfigured
 * (local dev, or before the widget is provisioned), in which case the component
 * renders nothing and the caller must not require a token. Safe to expose: the
 * sitekey is public and the widget is domain-restricted server-side.
 */
export const TURNSTILE_SITEKEY = (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? ''

/** The subset of the Turnstile JS API this component uses. */
interface TurnstileApi {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string
      action?: string
      callback: (token: string) => void
      'error-callback'?: () => void
      'expired-callback'?: () => void
    },
  ) => string
  reset: (widgetId?: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** Deduped loader promise so the script is injected at most once per page. */
let loaderPromise: Promise<TurnstileApi> | null = null

/**
 * Loads the Turnstile script once and resolves with its API object.
 *
 * @returns the global turnstile API once the script is ready.
 * @throws when the script fails to load or does not expose the API.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loaderPromise) return loaderPromise
  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile unavailable'))
    script.onerror = () => {
      // Let a later mount retry from scratch rather than caching the failure.
      loaderPromise = null
      reject(new Error('turnstile failed to load'))
    }
    document.head.appendChild(script)
  })
  return loaderPromise
}

/**
 * Renders a Cloudflare Turnstile widget and reports its token to the parent.
 *
 * A no-op when no sitekey is configured, so the auth flow works unchanged in
 * dev. The token is single-use: after the parent spends one (a code request) it
 * bumps `resetSignal` to fetch a fresh token for a possible resend. Token
 * lifecycle is surfaced through `onToken`: a string once solved, and null while
 * unsolved, expired, errored, or reset.
 *
 * @param onToken - called with the current token, or null when there is none.
 * @param resetSignal - increment to discard the current token and re-challenge.
 */
export function TurnstileWidget({
  onToken,
  resetSignal,
}: {
  onToken: (token: string | null) => void
  resetSignal: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Render the widget on mount and tear it down on unmount. onToken from useState
  // is stable, so this runs once per mounted instance.
  useEffect(() => {
    const container = containerRef.current
    if (!TURNSTILE_SITEKEY || !container) return
    let cancelled = false
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return
        widgetIdRef.current = turnstile.render(container, {
          sitekey: TURNSTILE_SITEKEY,
          action: 'email-request',
          callback: (token) => onToken(token),
          'error-callback': () => onToken(null),
          'expired-callback': () => onToken(null),
        })
      })
      .catch(() => {
        // Failed load leaves no token; the parent keeps the send button disabled.
        if (!cancelled) onToken(null)
      })
    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
      onToken(null)
    }
  }, [onToken])

  // Re-challenge whenever the parent bumps the signal, e.g. after the previous
  // token was consumed by a code request so a resend gets a fresh one.
  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current)
      onToken(null)
    }
  }, [resetSignal, onToken])

  if (!TURNSTILE_SITEKEY) return null
  return <div ref={containerRef} className="flex justify-center" />
}
