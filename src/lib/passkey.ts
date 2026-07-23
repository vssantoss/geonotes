import { Capacitor } from '@capacitor/core'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'
import { CapacitorPasskey } from '@capgo/capacitor-passkey'
import type {
  PasskeyAuthenticationCredential,
  PasskeyPublicKeyCredentialCreationOptionsJSON,
  PasskeyPublicKeyCredentialRequestOptionsJSON,
  PasskeyRegistrationCredential,
} from '@capgo/capacitor-passkey'

// Single entry point for the two WebAuthn ceremonies, dispatching by platform.
//
// On the web the page origin is the relying party's own domain, so the browser
// runs the ceremony via @simplewebauthn/browser. Inside the Capacitor WebView
// the page origin is https://localhost, which is not a registrable suffix of
// RP_ID (gnotes.vshub.app), so the browser WebAuthn API rejects the ceremony
// before it starts. Native therefore drives Android Credential Manager through
// @capgo/capacitor-passkey, which the server accepts because the app publishes a
// Digital Asset Link and the Worker allows the app's apk-key-hash origin.
//
// Both transports speak the same JSON: they take the server's option JSON and
// return the credential JSON @simplewebauthn/server verifies. The adapters below
// only bridge two independent TypeScript definitions of that identical shape
// (the plugin types binary fields as looser strings and reports an absent user
// handle as null rather than omitting it).

/**
 * Reshapes a native registration credential into the WebAuthn JSON the server
 * verifies. The runtime fields already match; this only reconciles the types.
 *
 * @param cred - the credential returned by the native plugin.
 * @returns the credential as a @simplewebauthn RegistrationResponseJSON.
 */
function toRegistrationResponseJSON(cred: PasskeyRegistrationCredential): RegistrationResponseJSON {
  return {
    id: cred.id,
    rawId: cred.rawId,
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment,
    clientExtensionResults: cred.clientExtensionResults,
    response: {
      clientDataJSON: cred.response.clientDataJSON,
      attestationObject: cred.response.attestationObject,
      authenticatorData: cred.response.authenticatorData,
      transports: cred.response.transports as AuthenticatorTransportFuture[] | undefined,
      publicKeyAlgorithm: cred.response.publicKeyAlgorithm,
      publicKey: cred.response.publicKey,
    },
  }
}

/**
 * Reshapes a native authentication credential into the WebAuthn JSON the server
 * verifies. The runtime fields already match; this only reconciles the types.
 *
 * @param cred - the credential returned by the native plugin.
 * @returns the credential as a @simplewebauthn AuthenticationResponseJSON.
 */
function toAuthenticationResponseJSON(
  cred: PasskeyAuthenticationCredential,
): AuthenticationResponseJSON {
  return {
    id: cred.id,
    rawId: cred.rawId,
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment,
    clientExtensionResults: cred.clientExtensionResults,
    response: {
      clientDataJSON: cred.response.clientDataJSON,
      authenticatorData: cred.response.authenticatorData,
      signature: cred.response.signature,
      // The plugin reports an absent user handle as null; the JSON form omits it,
      // so normalise null to undefined.
      userHandle: cred.response.userHandle ?? undefined,
    },
  }
}

/**
 * Runs a passkey registration ceremony and returns the response the server
 * verifies. Web uses the browser WebAuthn API; native uses Credential Manager.
 *
 * @param options - the creation option JSON from the server.
 * @returns the registration credential JSON to post back for verification.
 * @throws when the ceremony produces no credential (refused or cancelled); the
 *         caller decides whether to surface that as PasskeyUnavailableError.
 */
export async function passkeyCreate(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  if (Capacitor.isNativePlatform()) {
    // The two option definitions are the same WebAuthn JSON with differently
    // typed extension/transport fields, so cross the type boundary explicitly.
    const cred = await CapacitorPasskey.createCredential({
      publicKey: options as unknown as PasskeyPublicKeyCredentialCreationOptionsJSON,
    })
    return toRegistrationResponseJSON(cred)
  }
  return startRegistration({ optionsJSON: options })
}

/**
 * Runs a passkey authentication ceremony and returns the response the server
 * verifies. Web uses the browser WebAuthn API; native uses Credential Manager.
 *
 * @param options - the request option JSON from the server.
 * @returns the authentication credential JSON to post back for verification.
 * @throws when the ceremony produces no credential (no passkey or cancelled);
 *         the caller decides whether to surface that as PasskeyUnavailableError.
 */
export async function passkeyGet(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  if (Capacitor.isNativePlatform()) {
    const cred = await CapacitorPasskey.getCredential({
      // The plugin's createNativeRequest picks the get vs create code path by
      // `'mediation' in options`, not by which method was called. Without a
      // mediation key an authentication request is misrouted into the create
      // branch, which reads options.publicKey.rp.id and throws synchronously
      // (login options carry rpId, not rp.id), so the ceremony never reaches
      // Credential Manager. 'optional' selects a normal modal passkey prompt.
      mediation: 'optional',
      publicKey: options as unknown as PasskeyPublicKeyCredentialRequestOptionsJSON,
    })
    return toAuthenticationResponseJSON(cred)
  }
  return startAuthentication({ optionsJSON: options })
}
