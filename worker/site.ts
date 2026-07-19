import type { Env } from './_lib/env'

/** The one origin that keeps the plain "GeoNotes" name; everything else is dev. */
const PRODUCTION_ORIGIN = 'https://gnotes.vshub.app'

/** Path of the PWA manifest emitted by vite-plugin-pwa. */
const MANIFEST_PATH = '/manifest.webmanifest'

/** The name shown for non-production installs (staging, previews, local dev). */
const DEV_NAME = 'GeoNotes Dev'

/**
 * Serves the static site, labelling non-production installs "GeoNotes Dev" so a
 * staging install is visibly distinct from production on the home screen
 * (neither Android nor iOS offers a rename prompt at install time). A single
 * build serves both: the name is decided per request from env.ORIGIN, so no
 * dev-flavoured build can be deployed to production by mistake.
 *
 * The label lives in two places because the two platforms read different
 * sources: Android/Chrome use the manifest short_name, while iOS Safari ignores
 * the manifest and uses the apple-mobile-web-app-title meta (falling back to the
 * document <title>). So off production we rewrite both the manifest JSON and the
 * HTML document; on production every request passes straight through untouched.
 *
 * This is the router's catch-all: API paths are matched earlier and never reach
 * it. Unmatched paths come back from the assets binding as index.html with a 200
 * (not_found_handling = single-page-application), so deep links get the same
 * rewrite treatment as the root document.
 *
 * @param env - worker environment, for ORIGIN and the assets binding.
 * @param request - the incoming request.
 * @returns the asset response, name-patched when off production.
 */
export async function serveSite(env: Env, request: Request): Promise<Response> {
  // Production keeps its real name everywhere: skip all work, including the
  // per-request URL parse, for the origin that is by far the busiest.
  if (env.ORIGIN === PRODUCTION_ORIGIN) return env.ASSETS.fetch(request)

  const url = new URL(request.url)
  const response = await env.ASSETS.fetch(request)

  // Android/Chrome home-screen label comes from the manifest short_name.
  if (url.pathname === MANIFEST_PATH) {
    const manifest = (await response.json()) as { name?: string; short_name?: string }
    manifest.name = DEV_NAME
    manifest.short_name = DEV_NAME
    const headers = withoutStaleValidators(response.headers)
    headers.set('content-type', 'application/manifest+json')
    return new Response(JSON.stringify(manifest), { status: response.status, headers })
  }

  // iOS home-screen label comes from apple-mobile-web-app-title (or the
  // <title>). Rewrite the served HTML for navigations; assets/API are untouched.
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    const rewritten = new HTMLRewriter()
      .on('title', {
        element(el) {
          el.setInnerContent(DEV_NAME)
        },
      })
      .on('head', {
        element(el) {
          el.append(`<meta name="apple-mobile-web-app-title" content="${DEV_NAME}">`, {
            html: true,
          })
        },
      })
      .transform(response)
    return new Response(rewritten.body, {
      status: rewritten.status,
      headers: withoutStaleValidators(rewritten.headers),
    })
  }

  return response
}

/**
 * Clone a header set, dropping validators that no longer describe the body once
 * it has been rewritten. A stale ETag/Content-Length could otherwise trigger a
 * 304 or a truncated read against the modified content.
 *
 * @param source - the original response headers.
 * @returns a mutable copy without etag or content-length.
 */
function withoutStaleValidators(source: Headers): Headers {
  const headers = new Headers(source)
  headers.delete('etag')
  headers.delete('content-length')
  return headers
}
