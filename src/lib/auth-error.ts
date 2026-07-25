import { NetworkError } from './api'

/**
 * The locale key describing a failed auth request, so a call that never reached
 * the server is never reported as "something went wrong".
 *
 * That generic wording blames the app for a failure it did not cause: a phone in
 * airplane mode, or one that has wandered off Wi-Fi, gets the same message as a
 * genuine server fault and the user is sent looking for a problem that is not
 * there. Signing in is the one thing in GeoNotes that cannot work offline (the
 * notes themselves can), so it is worth saying exactly that.
 *
 * A device that believes it is online but still could not reach the API gets
 * different wording: a captive portal, a dead tunnel or an outage all land here,
 * and telling that user they are offline would be equally wrong advice.
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
