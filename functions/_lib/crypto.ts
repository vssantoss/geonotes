// Small WebCrypto helpers shared by the auth and session code.

/**
 * SHA-256 of a string.
 *
 * @param input - the string to hash.
 * @returns lowercase hex digest.
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Cryptographically random lowercase-hex string.
 *
 * @param bytes - entropy size in bytes.
 * @returns hex string twice as long as `bytes`.
 */
export function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * HMAC-SHA256 signature of a message.
 *
 * @param secret - shared secret.
 * @param message - message to sign.
 * @returns base64url signature.
 */
export async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return toBase64Url(new Uint8Array(sig))
}

/**
 * Encodes bytes as base64url without padding.
 *
 * @param bytes - raw bytes.
 * @returns base64url string.
 */
export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/**
 * Compares two encoded strings using the Workers timing-safe primitive.
 *
 * @param a - first encoded string.
 * @param b - second encoded string.
 * @returns true when equal.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  const lengthsMatch = left.byteLength === right.byteLength
  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(left, right)
    : !crypto.subtle.timingSafeEqual(left, left)
}
