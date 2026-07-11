/**
 * Generates a RFC 4122 v4 UUID.
 *
 * crypto.randomUUID only exists in secure contexts (https, localhost), so
 * plain-http dev access (e.g. via a LAN/Tailscale hostname) needs a fallback
 * built on crypto.getRandomValues, which is available everywhere.
 *
 * @returns a lowercase UUID string like "9b2f...-...".
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // Stamp the version (4) and variant (10xx) bits per RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
