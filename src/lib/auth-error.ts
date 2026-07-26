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
  if (!(err instanceof NetworkError)) return fallback
  return err.offline ? 'auth.error.offline' : 'auth.error.unreachable'
}

/**
 * The message key for a failed account-settings call (e-mail change, passkeys,
 * sessions, deletion). Same handling as authErrorKey, except that a device known
 * to be offline gets no message at all: Settings announces that once at the top
 * of the screen and disables the controls that need a connection, so a section
 * repeating it is the noise that notice exists to replace. Only a request that
 * was already in flight when the connection dropped can land here.
 *
 * @param err - the error thrown by the failed call.
 * @param fallback - locale key for anything that is not a connection failure.
 * @returns the locale key for the message to show, or null to show none.
 */
export function settingsErrorKey(err: unknown, fallback = 'auth.error.generic'): string | null {
  if (!(err instanceof NetworkError)) return fallback
  return err.offline ? null : 'auth.error.unreachable'
}
