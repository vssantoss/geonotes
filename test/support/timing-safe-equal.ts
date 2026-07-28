/**
 * A Node stand-in for workerd's `crypto.subtle.timingSafeEqual`.
 *
 * The integration suite runs the Worker's handlers in-process under Node, which
 * implements WebCrypto but not this Cloudflare extension. Any test that drives a
 * route through worker/_lib/crypto.ts's timingSafeEqual (every e-mail code and
 * token comparison) therefore dies with a TypeError before reaching the
 * behaviour under test. Installing an ordinary byte comparison makes those
 * routes runnable; the real primitive's constant-time property is a property of
 * production, not something a test can observe.
 */

/** The subset of the workerd extension the Worker actually calls. */
type TimingSafeEqual = (a: ArrayBufferView, b: ArrayBufferView) => boolean

/**
 * Installs the shim onto crypto.subtle when the runtime lacks it.
 *
 * Idempotent, and a no-op anywhere the native primitive exists, so it can be
 * called unconditionally from a test's setup.
 *
 * @returns Nothing.
 */
export function installTimingSafeEqual(): void {
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: TimingSafeEqual }
  if (typeof subtle.timingSafeEqual === 'function') return

  const compare: TimingSafeEqual = (a, b) => {
    const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    // workerd throws on a length mismatch rather than returning false, and the
    // caller in crypto.ts relies on that by only ever passing equal lengths.
    if (left.byteLength !== right.byteLength) throw new TypeError('length mismatch')
    let diff = 0
    for (let i = 0; i < left.byteLength; i++) diff |= left[i] ^ right[i]
    return diff === 0
  }

  Object.defineProperty(subtle, 'timingSafeEqual', { value: compare, configurable: true })
}
