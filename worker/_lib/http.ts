import type { Context } from 'hono'

/**
 * Security headers applied to every API response.
 *
 * public/_headers only covers static assets under Workers (unlike Pages, where
 * it also covered Functions output), so API responses have to carry their own.
 * Only the two that mean anything for a non-HTML body are set here: nosniff, and
 * a referrer policy so an API URL never leaks onward.
 */
const API_SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

/**
 * Builds a JSON response.
 *
 * @param data - serializable payload.
 * @param status - HTTP status, default 200.
 * @returns the Response.
 */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...API_SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  })
}

/**
 * Builds a plain-text error response.
 *
 * @param status - HTTP status.
 * @param message - short human-readable reason.
 * @returns the Response.
 */
export function error(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      ...API_SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=UTF-8',
    },
  })
}

/** Thrown by helpers to bubble an HTTP error out of nested calls. */
export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Minimum environment fields required by the shared route wrapper. */
interface RouteEnv {
  ORIGIN: string
}

/**
 * Rejects cross-origin state-changing requests before route logic runs.
 *
 * @param env - function environment containing the allowed web origin.
 * @param request - incoming request.
 * @throws HttpError(403) when an unsafe request has no matching Origin header.
 */
function requireTrustedOrigin(env: RouteEnv, request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return
  if (!hasTrustedOrigin(request, env.ORIGIN)) throw new HttpError(403, 'bad origin')
}

/**
 * Checks whether a request carries the configured same-origin identity.
 *
 * @param request - incoming request.
 * @param expectedOrigin - exact allowed web origin.
 * @returns true only when the Origin header matches.
 */
export function hasTrustedOrigin(request: Request, expectedOrigin: string): boolean {
  return request.headers.get('Origin') === expectedOrigin
}

/**
 * The slice of the old Pages EventContext that route handlers actually use.
 * Keeping this shape is what let every route body survive the move off Pages
 * Functions unchanged: only this wrapper knows it is now driven by Hono.
 */
export interface RouteContext<E extends RouteEnv> {
  env: E
  request: Request
  params: Record<string, string | undefined>
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Wraps a route handler so HttpError becomes a proper response and anything
 * unexpected becomes an opaque 500, and adapts the Hono context into the
 * EventContext-shaped object the handlers expect.
 *
 * @param handler - the actual route logic.
 * @returns a Hono-compatible handler.
 */
export function route<E extends RouteEnv>(
  handler: (ctx: RouteContext<E>) => Promise<Response>,
): (c: Context<{ Bindings: E }>) => Promise<Response> {
  return async (c) => {
    try {
      requireTrustedOrigin(c.env, c.req.raw)
      return await handler({
        env: c.env,
        request: c.req.raw,
        params: c.req.param() as Record<string, string | undefined>,
        waitUntil: (promise) => {
          // executionCtx throws when the app is driven without one, which is how
          // the router tests call it. Background work is best-effort either way,
          // so fall back to firing and forgetting rather than failing the
          // request that scheduled it.
          try {
            c.executionCtx.waitUntil(promise)
          } catch {
            void promise.catch((err) => console.error(err))
          }
        },
      })
    } catch (err) {
      if (err instanceof HttpError) return error(err.status, err.message)
      console.error(err)
      return error(500, 'internal error')
    }
  }
}
