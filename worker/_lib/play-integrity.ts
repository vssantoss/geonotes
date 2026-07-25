import { HttpError } from './http'
import { toBase64Url } from './crypto'
import type { Env } from './env'

/**
 * The Android application id whose Play Integrity tokens we accept. Must match
 * the installed APK's package (android/app/build.gradle `applicationId`) and the
 * package registered on the linked Google Play / Cloud project. A token whose
 * decoded request package differs is rejected, so a token minted for a different
 * app can never authorize a GeoNotes e-mail request.
 */
const EXPECTED_PACKAGE = 'app.vshub.gnotes'

/** OAuth scope required to call decodeIntegrityToken. */
const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity'

/** Google's OAuth token endpoint for the JWT-bearer grant. */
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** Upper bound on an integrity token; real ones are a few KB. Rejects oversized
    junk before it reaches Google. */
const MAX_TOKEN_LENGTH = 16_384

/** How stale a token's server-stamped timestamp may be before we reject it, as a
    replay window. Play Integrity standard tokens are meant to be used promptly. */
const MAX_TOKEN_AGE_MS = 10 * 60 * 1000

/** Minimal shape of a Google service-account JSON key, the fields we sign with. */
interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

/** The decoded Play Integrity payload, only the fields this check reads. */
interface IntegrityPayload {
  requestDetails?: {
    requestPackageName?: string
    requestHash?: string
    timestampMillis?: string
  }
  appIntegrity?: {
    appRecognitionVerdict?: string
  }
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[]
  }
}

/**
 * Caches the minted OAuth access token across requests handled by the same
 * isolate, so a burst of e-mail requests does not re-sign a JWT and round-trip to
 * Google's token endpoint every time. Refreshed once inside a safety margin of
 * expiry. Module scope, so it is naturally per-isolate and never shared between
 * accounts (there is only one service account).
 */
let cachedAccessToken: { token: string; expiresAtMs: number } | null = null

/**
 * Verifies a Google Play Integrity token server-side before the same abuse-prone
 * action Turnstile guards on web (sending an e-mail code) runs on native.
 *
 * Mirrors verifyTurnstile's no-op-when-unconfigured contract: with no
 * PLAY_INTEGRITY_SA_JSON set (local dev, or before the credential is provisioned)
 * the check is skipped so the flow keeps working. Once the key is present a
 * missing, oversized or unverifiable token fails closed with 403.
 *
 * The token is decoded via Google-managed decryption: we mint an OAuth token from
 * the service-account key and POST the integrity token to decodeIntegrityToken.
 * We then check the token was minted for THIS app (requestPackageName), for THIS
 * request (requestHash, which the client sets to sha256(email) so a token cannot
 * be replayed against a different address) and recently (timestampMillis). By
 * default device/app verdicts are NOT required, so a sideloaded debug build
 * (reported UNRECOGNIZED_VERSION) still passes; PLAY_INTEGRITY_STRICT tightens
 * that to full verdicts for production. There is deliberately no "skip because the
 * caller claims to be native" path: a client that sends no token falls through to
 * the Turnstile check, and a bad token is rejected here, so neither is a bypass.
 *
 * @param env - function environment (holds PLAY_INTEGRITY_SA_JSON when configured).
 * @param token - the integrity token produced by the Android client.
 * @param expectedRequestHash - the hash the token must carry, sha256(email) hex,
 *          binding the token to this specific e-mail request.
 * @throws HttpError(403) when Play Integrity is configured and the token is
 *         missing, malformed, decodes to a different app/request, is stale, fails
 *         a required verdict, or cannot be decoded (Google outage fails closed).
 */
export async function verifyPlayIntegrity(
  env: Env,
  token: unknown,
  expectedRequestHash: string,
): Promise<void> {
  const saJson = env.PLAY_INTEGRITY_SA_JSON
  // Unconfigured: skip entirely, mirroring verifyTurnstile's no-op.
  if (!saJson) return
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new HttpError(403, 'attestation required')
  }

  const sa = parseServiceAccount(saJson)
  const payload = await decodeIntegrityToken(sa, token)

  const details = payload.requestDetails
  // The token must be minted for this exact app; otherwise a token issued to some
  // other Play app could authorize our requests.
  if (details?.requestPackageName !== EXPECTED_PACKAGE) {
    throw new HttpError(403, 'attestation rejected')
  }
  // The client sets requestHash to sha256(email), binding the token to this
  // address so it cannot be lifted onto a request for a different one.
  if (details.requestHash !== expectedRequestHash) {
    throw new HttpError(403, 'attestation rejected')
  }
  // Reject a token whose server timestamp is missing or outside the replay window.
  const stamped = Number(details.timestampMillis)
  if (!Number.isFinite(stamped) || Math.abs(Date.now() - stamped) > MAX_TOKEN_AGE_MS) {
    throw new HttpError(403, 'attestation rejected')
  }

  // Strict mode (production, app installed from a Play track): require a genuine
  // device and a Play-recognized app. Off by default so debug/sideloaded builds,
  // which Google reports as UNRECOGNIZED_VERSION with no device verdict, still
  // pass once the token is proven to come from our app for this request.
  if (isStrict(env)) {
    const deviceOk = payload.deviceIntegrity?.deviceRecognitionVerdict?.includes(
      'MEETS_DEVICE_INTEGRITY',
    )
    const appOk = payload.appIntegrity?.appRecognitionVerdict === 'PLAY_RECOGNIZED'
    if (!deviceOk || !appOk) throw new HttpError(403, 'attestation rejected')
  }
}

/**
 * Reports whether strict verdict checking is enabled.
 *
 * @param env - function environment.
 * @returns true when PLAY_INTEGRITY_STRICT is '1' or 'true'.
 */
function isStrict(env: Env): boolean {
  const v = env.PLAY_INTEGRITY_STRICT
  return v === '1' || v === 'true'
}

/**
 * Parses the service-account JSON secret into the fields needed to sign.
 *
 * @param saJson - the raw JSON string from PLAY_INTEGRITY_SA_JSON.
 * @returns the parsed service account.
 * @throws HttpError(403) when the secret is not valid JSON or lacks credentials,
 *         which is a misconfiguration; failing closed keeps the action gated.
 */
function parseServiceAccount(saJson: string): ServiceAccount {
  let sa: ServiceAccount
  try {
    sa = JSON.parse(saJson) as ServiceAccount
  } catch {
    throw new HttpError(403, 'attestation verification failed')
  }
  if (!sa.client_email || !sa.private_key) {
    throw new HttpError(403, 'attestation verification failed')
  }
  return sa
}

/**
 * Calls Google's decodeIntegrityToken with a service-account OAuth token and
 * returns the decoded payload.
 *
 * @param sa - the service account used to authorize the call.
 * @param token - the integrity token to decode.
 * @returns the decoded token payload.
 * @throws HttpError(403) when decoding fails, including a network outage, which
 *         fails closed rather than letting the action through unverified.
 */
async function decodeIntegrityToken(
  sa: ServiceAccount,
  token: string,
): Promise<IntegrityPayload> {
  const accessToken = await getAccessToken(sa)
  const url = `https://playintegrity.googleapis.com/v1/${EXPECTED_PACKAGE}:decodeIntegrityToken`
  let body: { tokenPayloadExternal?: IntegrityPayload }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ integrity_token: token }),
    })
    if (!res.ok) throw new Error(`decode ${res.status}`)
    body = (await res.json()) as { tokenPayloadExternal?: IntegrityPayload }
  } catch {
    throw new HttpError(403, 'attestation verification failed')
  }
  if (!body.tokenPayloadExternal) throw new HttpError(403, 'attestation rejected')
  return body.tokenPayloadExternal
}

/**
 * Returns a valid OAuth access token for the Play Integrity scope, minting and
 * caching a new one when none is cached or the cached one is near expiry.
 *
 * @param sa - the service account to authenticate as.
 * @returns a bearer access token.
 * @throws HttpError(403) when the token exchange fails (fails closed).
 */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  // Reuse a cached token until 60s before it expires, to absorb clock skew.
  if (cachedAccessToken && cachedAccessToken.expiresAtMs - 60_000 > Date.now()) {
    return cachedAccessToken.token
  }
  const assertion = await buildSignedJwt(sa)
  let out: { access_token?: string; expires_in?: number }
  try {
    const res = await fetch(sa.token_uri ?? OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })
    if (!res.ok) throw new Error(`token ${res.status}`)
    out = (await res.json()) as { access_token?: string; expires_in?: number }
  } catch {
    throw new HttpError(403, 'attestation verification failed')
  }
  if (!out.access_token) throw new HttpError(403, 'attestation verification failed')
  const expiresAtMs = Date.now() + (out.expires_in ?? 3600) * 1000
  cachedAccessToken = { token: out.access_token, expiresAtMs }
  return out.access_token
}

/**
 * Builds and signs the RS256 JWT assertion for the OAuth JWT-bearer grant.
 *
 * @param sa - the service account whose private key signs the assertion.
 * @returns the signed JWT (header.payload.signature).
 */
async function buildSignedJwt(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    scope: PLAY_INTEGRITY_SCOPE,
    aud: sa.token_uri ?? OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }
  const encoder = new TextEncoder()
  const signingInput = `${toBase64Url(encoder.encode(JSON.stringify(header)))}.${toBase64Url(
    encoder.encode(JSON.stringify(claims)),
  )}`
  const key = await importPrivateKey(sa.private_key)
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signingInput),
  )
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`
}

/**
 * Imports a PEM PKCS#8 private key for RS256 signing via Web Crypto.
 *
 * @param pem - the PEM-encoded private key from the service account.
 * @returns a CryptoKey usable with RSASSA-PKCS1-v1_5 / SHA-256.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip the PEM armor and newlines, then base64-decode to the DER bytes.
  const der = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const bytes = Uint8Array.from(atob(der), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}
