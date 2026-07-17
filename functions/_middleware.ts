import type { Env } from './_lib/env'

/** The one origin that keeps the plain "GeoNotes" name; everything else is dev. */
const PRODUCTION_ORIGIN = 'https://gnotes.vshub.app'

/** Path of the PWA manifest emitted by vite-plugin-pwa. */
const MANIFEST_PATH = '/manifest.webmanifest'

/** The name shown for non-production installs (staging, previews, local dev). */
const DEV_NAME = 'GeoNotes Dev'

/**
 * Root Pages middleware. Its only job is to rename the PWA manifest on
 * non-production origins so a staging install is visibly distinct from
 * production on the Android home screen (Android gives no rename prompt at
 * install time). A single build serves both: the name is decided per request
 * from env.ORIGIN, so there is no dev-flavoured build that could be deployed to
 * production by mistake. Every non-manifest request passes straight through.
 *
 * @param context - the Pages request context (request, env, next).
 * @returns the manifest with a "Dev" name off production, else the untouched response.
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context

  // Cheap early-out: this middleware wraps every request, so anything that is
  // not the manifest returns immediately with no added work.
  if (new URL(request.url).pathname !== MANIFEST_PATH) return next()

  const response = await next()

  // Production keeps its real name; all other origins get the "Dev" label.
  if (env.ORIGIN === PRODUCTION_ORIGIN) return response

  const manifest = (await response.json()) as { name?: string; short_name?: string }
  manifest.name = DEV_NAME
  manifest.short_name = DEV_NAME

  // Rebuild the response with fresh validators: the body changed, so the
  // original ETag/Content-Length no longer describe it and must not be reused.
  const headers = new Headers(response.headers)
  headers.delete('etag')
  headers.delete('content-length')
  headers.set('content-type', 'application/manifest+json')

  return new Response(JSON.stringify(manifest), { status: response.status, headers })
}
