import { HttpError } from './http'
import { fromBase64, toBase64Url } from './crypto'
import type { Env } from './env'

/** Fallback application id when ANDROID_PACKAGE is unset, so a deploy that has
    the service-account secret but not the var still checks the package it has
    always checked rather than accepting any app's token. */
const DEFAULT_ANDROID_PACKAGE = 'app.vshub.gnotes'

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
 * Google's token endpoint every time. The pending promise is what is cached, not
 * the resolved value, so concurrent requests on a cold isolate share one mint
 * instead of each signing a JWT and calling Google. Refreshed once inside a
 * safety margin of expiry. Module scope, so it is naturally per-isolate and never
 * shared between accounts (there is only one service account).
 */
let cachedAccessToken: Promise<{ token: string; expiresAtMs: number }> | null = null

/**
 * Caches the parsed service account and its imported signing key, keyed on the
 * raw secret so a rotated value is never served from the old parse. Both are
 * pure functions of that string, and re-deriving them meant a JSON.parse of the
 * key file plus a PEM decode and importKey on every attested request.
 */
let cachedCredentials: { raw: string; sa: ServiceAccount; key: CryptoKey } | null = null

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

  const expectedPackage = env.ANDROID_PACKAGE ?? DEFAULT_ANDROID_PACKAGE
  const credentials = await loadCredentials(saJson)
  const payload = await decodeIntegrityToken(credentials, expectedPackage, token)

  const details = payload.requestDetails
  // The token must be minted for this exact app; otherwise a token issued to some
  // other Play app could authorize our requests.
  if (details?.requestPackageName !== expectedPackage) {
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
 * The service account together with its imported signing key: everything needed
 * to authenticate to Google, derived once from the secret.
 */
interface Credentials {
  sa: ServiceAccount
  key: CryptoKey
}

/**
 * Parses the service-account JSON secret and imports its signing key, reusing
 * the previous result while the secret is unchanged.
 *
 * @param saJson - the raw JSON string from PLAY_INTEGRITY_SA_JSON.
 * @returns the parsed service account and its imported signing key.
 * @throws HttpError(403) when the secret is not valid JSON or lacks credentials,
 *         which is a misconfiguration; failing closed keeps the action gated.
 */
async function loadCredentials(saJson: string): Promise<Credentials> {
  if (cachedCredentials?.raw === saJson) return cachedCredentials
  let sa: ServiceAccount
  try {
    sa = JSON.parse(saJson) as ServiceAccount
  } catch {
    throw new HttpError(403, 'attestation verification failed')
  }
  if (!sa.client_email || !sa.private_key) {
    throw new HttpError(403, 'attestation verification failed')
  }
  const key = await importPrivateKey(sa.private_key)
  cachedCredentials = { raw: saJson, sa, key }
  return cachedCredentials
}

/**
 * POSTs to a Google endpoint and parses its JSON reply, turning every failure
 * mode into the same opaque 403.
 *
 * Both calls in this file fail closed identically: a non-2xx, an unparseable
 * body and a network outage all mean the attestation could not be verified, and
 * none of them may leak Google's response to the caller.
 *
 * @param url - the endpoint to post to.
 * @param init - fetch options carrying the method's headers and body.
 * @returns the parsed response body.
 * @throws HttpError(403) when the call fails or its body is not JSON.
 */
async function postToGoogle<T>(url: string, init: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, { method: 'POST', ...init })
    if (!res.ok) throw new Error(`${url} ${res.status}`)
    return (await res.json()) as T
  } catch {
    throw new HttpError(403, 'attestation verification failed')
  }
}

/**
 * Calls Google's decodeIntegrityToken with a service-account OAuth token and
 * returns the decoded payload.
 *
 * @param credentials - the service account used to authorize the call.
 * @param packageName - the application id the token was minted for.
 * @param token - the integrity token to decode.
 * @returns the decoded token payload.
 * @throws HttpError(403) when decoding fails, including a network outage, which
 *         fails closed rather than letting the action through unverified.
 */
async function decodeIntegrityToken(
  credentials: Credentials,
  packageName: string,
  token: string,
): Promise<IntegrityPayload> {
  const accessToken = await getAccessToken(credentials)
  const body = await postToGoogle<{ tokenPayloadExternal?: IntegrityPayload }>(
    `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ integrity_token: token }),
    },
  )
  if (!body.tokenPayloadExternal) throw new HttpError(403, 'attestation rejected')
  return body.tokenPayloadExternal
}

/**
 * Returns a valid OAuth access token for the Play Integrity scope, minting and
 * caching a new one when none is cached or the cached one is near expiry.
 *
 * @param credentials - the service account to authenticate as.
 * @returns a bearer access token.
 * @throws HttpError(403) when the token exchange fails (fails closed).
 */
async function getAccessToken(credentials: Credentials): Promise<string> {
  // Reuse a cached token until 60s before it expires, to absorb clock skew.
  const cached = cachedAccessToken ? await cachedAccessToken.catch(() => null) : null
  if (cached && cached.expiresAtMs - 60_000 > Date.now()) return cached.token
  // Cache the in-flight promise, so requests arriving during the mint await this
  // one rather than each signing a JWT and calling Google. Cleared on failure so
  // the next request retries instead of inheriting the rejection.
  const pending = mintAccessToken(credentials)
  cachedAccessToken = pending
  pending.catch(() => {
    if (cachedAccessToken === pending) cachedAccessToken = null
  })
  return (await pending).token
}

/**
 * Exchanges a signed JWT assertion for an OAuth access token.
 *
 * @param credentials - the service account to authenticate as.
 * @returns the minted token and the wall-clock time it expires at.
 * @throws HttpError(403) when the exchange fails or returns no token.
 */
async function mintAccessToken(
  credentials: Credentials,
): Promise<{ token: string; expiresAtMs: number }> {
  const assertion = await buildSignedJwt(credentials)
  const out = await postToGoogle<{ access_token?: string; expires_in?: number }>(
    credentials.sa.token_uri ?? OAUTH_TOKEN_URL,
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    },
  )
  if (!out.access_token) throw new HttpError(403, 'attestation verification failed')
  return { token: out.access_token, expiresAtMs: Date.now() + (out.expires_in ?? 3600) * 1000 }
}

/**
 * Builds and signs the RS256 JWT assertion for the OAuth JWT-bearer grant.
 *
 * @param credentials - the service account whose key signs the assertion.
 * @returns the signed JWT (header.payload.signature).
 */
async function buildSignedJwt({ sa, key }: Credentials): Promise<string> {
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
  return crypto.subtle.importKey(
    'pkcs8',
    fromBase64(der),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}
