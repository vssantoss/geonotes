/**
 * SHA-256 of a string, hex encoded.
 *
 * The one digest primitive the app shares, so callers that must agree with the
 * server (the Play Integrity request hash) and callers that are purely local
 * (the account marker) can each keep their own meaning without also keeping
 * their own copy of the encoding.
 *
 * @param input - the string to hash.
 * @returns a lowercase hex digest.
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
