import { NetworkError } from './api'

/**
 * Locale keys for a failed account request, so a call that never reached the
 * server is never reported as "something went wrong".
 *
 * That generic wording blames the app for a failure it did not cause: a phone in
 * airplane mode, or one that has wandered off Wi-Fi, gets the same message as a
 * genuine server fault and the user is sent looking for a problem that is not
 * there. Everything touching the account (signing in, changing the e-mail,
 * managing passkeys and sessions, deleting the account) needs the network,
 * unlike the notes themselves, so it is worth saying exactly that.
 *
 * A device that believes it is online but still could not reach the API gets
 * different wording either way: a captive portal, a dead tunnel or an outage all
 * land there, and telling that user they are offline would be equally wrong
 * advice.
 */

/**
 * The message key for a failed sign-in call, whose offline wording names signing
 * in specifically and reassures that the notes still work without a connection.
 *
 * @param err - the error thrown by the failed call.
 * @param fallback - locale key for anything that is not a connection failure,
 *          i.e. the message the call site would otherwise have shown.
 * @returns the locale key for the message to show.
 */
export function authErrorKey(err: unknown, fallback = 'auth.error.generic'): string {
  return connectionKey(err, 'auth.error.offline', fallback)
}

/**
 * The message key for a failed account-settings call (e-mail change, passkeys,
 * sessions, deletion). Same handling as authErrorKey with wording that fits an
 * action taken while already signed in.
 *
 * @param err - the error thrown by the failed call.
 * @param fallback - locale key for anything that is not a connection failure.
 * @returns the locale key for the message to show.
 */
export function settingsErrorKey(err: unknown, fallback = 'auth.error.generic'): string {
  return connectionKey(err, 'settings.error.offline', fallback)
}

/**
 * Shared mapping: a connection failure picks between the caller's offline
 * wording and the unreachable one, anything else keeps the caller's fallback.
 *
 * @param err - the error thrown by the failed call.
 * @param offline - locale key for a device that knows it has no connection.
 * @param fallback - locale key for a failure the server actually answered.
 * @returns the locale key for the message to show.
 */
function connectionKey(err: unknown, offline: string, fallback: string): string {
  if (!(err instanceof NetworkError)) return fallback
  return err.offline ? offline : 'auth.error.unreachable'
}
