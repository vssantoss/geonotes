import { Hono } from 'hono'
import { error } from './_lib/http'
import { serveSite } from './site'
import type { Env } from './_lib/env'

import { onRequestGet as geocode } from './api/geocode'
import { onRequestPost as sync } from './api/sync'
import { onRequestPost as contact } from './api/auth/contact'
import { onRequestGet as credentialsList } from './api/auth/credentials'
import { onRequestDelete as credentialDelete } from './api/auth/credentials/by-id'
import { onRequestPost as credentialRegister } from './api/auth/credentials/register'
import { onRequestPost as credentialRegisterOptions } from './api/auth/credentials/register-options'
import { onRequestPost as deleteAccount } from './api/auth/delete-account'
import { onRequestPost as emailChange } from './api/auth/email-change'
import { onRequestPost as emailChangeRequest } from './api/auth/email-change-request'
import { onRequestPost as emailRequest } from './api/auth/email-request'
import { onRequestPost as emailVerify } from './api/auth/email-verify'
import { onRequestPost as logout } from './api/auth/logout'
import { onRequestPost as passkeyLogin } from './api/auth/passkey-login'
import { onRequestPost as passkeyLoginOptions } from './api/auth/passkey-login-options'
import { onRequestPost as passkeyRegister } from './api/auth/passkey-register'
import { onRequestPost as passkeyRegisterOptions } from './api/auth/passkey-register-options'
import { onRequestGet as sessionsList } from './api/auth/sessions'
import { onRequestDelete as sessionDelete } from './api/auth/sessions/by-id'
import { onRequestPost as sessionsRevokeOthers } from './api/auth/sessions/revoke-others'

/**
 * The GeoNotes Worker's request router.
 *
 * Under Pages these routes came from the file tree; here they are declared, so
 * this file is the single place that defines the API's URL surface. Handlers
 * keep their onRequest<Method> export names from that era and are aliased on
 * import, which is why the route bodies themselves needed no changes.
 */
export const app = new Hono<{ Bindings: Env }>()

app.get('/api/geocode', geocode)
app.post('/api/sync', sync)

app.post('/api/auth/contact', contact)
app.post('/api/auth/delete-account', deleteAccount)
app.post('/api/auth/email-change', emailChange)
app.post('/api/auth/email-change-request', emailChangeRequest)
app.post('/api/auth/email-request', emailRequest)
app.post('/api/auth/email-verify', emailVerify)
app.post('/api/auth/logout', logout)
app.post('/api/auth/passkey-login', passkeyLogin)
app.post('/api/auth/passkey-login-options', passkeyLoginOptions)
app.post('/api/auth/passkey-register', passkeyRegister)
app.post('/api/auth/passkey-register-options', passkeyRegisterOptions)

// Static segments are registered before the :id routes they could collide with.
// Hono prefers a static match anyway, but the order documents the intent.
app.get('/api/auth/credentials', credentialsList)
app.post('/api/auth/credentials/register', credentialRegister)
app.post('/api/auth/credentials/register-options', credentialRegisterOptions)
app.delete('/api/auth/credentials/:id', credentialDelete)

app.get('/api/auth/sessions', sessionsList)
app.post('/api/auth/sessions/revoke-others', sessionsRevokeOthers)
app.delete('/api/auth/sessions/:id', sessionDelete)

// Unmatched API paths must fail as API paths. Without this they would reach the
// catch-all below and be answered with index.html and a 200, turning a typo'd
// endpoint into a JSON parse error on the client instead of an ApiError(404).
app.all('/api/*', () => error(404, 'not found'))

app.all('*', (c) => serveSite(c.env, c.req.raw))
