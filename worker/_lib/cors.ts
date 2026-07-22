import type { MiddlewareHandler } from 'hono'

// The origins a Capacitor webview serves its UI from: https://localhost on
// Android, capacitor://localhost on iOS. These are the only cross-origin callers
// the API answers. Every browser request comes from env.ORIGIN and is
// same-origin, so it never carries a matching Origin and never triggers CORS.
const NATIVE_ORIGINS = new Set(['https://localhost', 'capacitor://localhost'])

// What the native client is allowed to send. Authorization carries the native
// session bearer token (Fix C); the web cookie is never sent cross-origin.
const ALLOW_METHODS = 'GET, POST, DELETE, OPTIONS'
const ALLOW_HEADERS = 'Content-Type, Authorization'
// Cache a successful preflight for a day so the browser stops re-asking.
const MAX_AGE = '86400'

/**
 * Returns the request's Origin when it is a trusted native webview origin, else
 * null. Only an exact allowlist match qualifies; anything else gets no CORS
 * headers and is left for the browser to block.
 *
 * @param request - the incoming request.
 * @returns the matched origin string, or null.
 */
function nativeOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin')
  return origin !== null && NATIVE_ORIGINS.has(origin) ? origin : null
}

/**
 * Reports whether a request comes from a trusted native webview origin. Login
 * endpoints use this to decide whether to return the raw session token in the
 * response body: native needs it for the bearer transport, but the web must
 * never receive it there (its token stays HttpOnly in the cookie, out of reach
 * of XSS). The Origin header is browser-controlled and unforgeable by page
 * script, so a web XSS running at env.ORIGIN cannot pass this check.
 *
 * @param request - the incoming request.
 * @returns true when the Origin is a trusted native webview origin.
 */
export function isNativeOrigin(request: Request): boolean {
  return nativeOrigin(request) !== null
}

/**
 * Hono middleware that grants CORS to the native (Capacitor) webview origins on
 * /api/*, and only those. It answers the browser's preflight (OPTIONS) directly
 * and reflects the allowed origin onto every /api response, successes and errors
 * alike, so the WebView may read the status and body (a 403 from the origin/CSRF
 * check must stay readable, not surface as an opaque CORS failure).
 *
 * It deliberately does NOT send Access-Control-Allow-Credentials: native auth
 * uses an Authorization bearer token, not the browser cookie, so cross-origin
 * cookie sharing stays off. This is what lets the web cookie keep SameSite=Strict
 * and the __Host- prefix, and lets requireTrustedOrigin stay strict, none of them
 * are touched to make native work. Web requests are same-origin, match no native
 * origin, and pass through with no CORS headers added.
 */
export const cors: MiddlewareHandler = async (c, next) => {
  const origin = nativeOrigin(c.req.raw)

  // Preflight: approve the pending request without running route logic or the
  // origin check. An unknown origin gets a bare 204 with no CORS headers, so the
  // browser refuses to send the real request.
  if (c.req.method === 'OPTIONS') {
    const headers = new Headers()
    if (origin !== null) {
      headers.set('Access-Control-Allow-Origin', origin)
      headers.set('Access-Control-Allow-Methods', ALLOW_METHODS)
      headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS)
      headers.set('Access-Control-Max-Age', MAX_AGE)
      headers.set('Vary', 'Origin')
    }
    return new Response(null, { status: 204, headers })
  }

  await next()

  // Reflect the origin onto the actual response so the WebView may read it.
  // Vary: Origin stops a shared cache reusing one origin's response for another.
  if (origin !== null) {
    c.res.headers.set('Access-Control-Allow-Origin', origin)
    c.res.headers.set('Vary', 'Origin')
  }
}
