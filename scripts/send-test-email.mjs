// Standalone Resend smoke test: sends one e-mail to confirm the API key and
// (optionally) domain verification work, independent of the app.
//
// Usage: node scripts/send-test-email.mjs [recipient]
// Reads RESEND_API_KEY from the environment, or falls back to .dev.vars.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

/**
 * Reads a variable from process.env, falling back to the project's .dev.vars.
 *
 * @param name - variable name to look up.
 * @returns the value, or undefined when not set anywhere.
 */
function readVar(name) {
  if (process.env[name]) return process.env[name]
  try {
    const text = readFileSync(join(projectRoot, '.dev.vars'), 'utf8')
    const line = text.split('\n').find((l) => l.trim().startsWith(`${name}=`))
    return line ? line.slice(line.indexOf('=') + 1).trim() : undefined
  } catch {
    return undefined
  }
}

const apiKey = readVar('RESEND_API_KEY')
if (!apiKey) {
  console.error('RESEND_API_KEY is not set (checked env and .dev.vars).')
  process.exit(1)
}

const to = process.argv[2] || 'victor@victorsantos.org'
// Preferred sender uses the app's verified domain; the fallback is Resend's
// shared sandbox address, which works before any domain is verified.
const preferredFrom = 'GeoNotes <gnotes@vshub.app>'
const fallbackFrom = 'GeoNotes <onboarding@resend.dev>'

/**
 * Sends one e-mail through Resend's REST API.
 *
 * @param from - sender address (must be verified unless it is resend.dev).
 * @returns the parsed Resend response body.
 * @throws Error carrying the HTTP status and Resend's error body on failure.
 */
async function send(from) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: 'GeoNotes Resend test',
      text: 'This is a test e-mail confirming Resend is wired up for GeoNotes.',
      html: '<p>This is a test e-mail confirming <strong>Resend</strong> is wired up for GeoNotes.</p>',
    }),
  })
  const body = await res.text()
  if (!res.ok) {
    const err = new Error(`Resend ${res.status}: ${body}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return JSON.parse(body)
}

try {
  const result = await send(preferredFrom)
  console.log(`Sent from ${preferredFrom} to ${to}. Resend id: ${result.id}`)
} catch (err) {
  // A verified-domain failure usually means DNS is not done yet; retry from
  // the sandbox address so we can still prove the API key works.
  console.warn(`Preferred sender failed: ${err.message}`)
  console.warn('Retrying from Resend sandbox address...')
  const result = await send(fallbackFrom)
  console.log(
    `Sent from ${fallbackFrom} to ${to}. Resend id: ${result.id}\n` +
      'NOTE: domain vshub.app is not verified yet, so the app cannot send from gnotes@vshub.app until you finish DNS setup in Resend.',
  )
}
