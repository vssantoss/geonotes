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
    headers: { 'Content-Type': 'application/json' },
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
  return new Response(message, { status })
}

/** Thrown by helpers to bubble an HTTP error out of nested calls. */
export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Wraps a route handler so HttpError becomes a proper response and anything
 * unexpected becomes an opaque 500.
 *
 * @param handler - the actual route logic.
 * @returns a PagesFunction-compatible handler.
 */
export function route<E>(
  handler: (ctx: EventContext<E, string, unknown>) => Promise<Response>,
): (ctx: EventContext<E, string, unknown>) => Promise<Response> {
  return async (ctx) => {
    try {
      return await handler(ctx)
    } catch (err) {
      if (err instanceof HttpError) return error(err.status, err.message)
      console.error(err)
      return error(500, 'internal error')
    }
  }
}
