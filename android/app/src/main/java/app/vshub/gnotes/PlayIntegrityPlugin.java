package app.vshub.gnotes;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.StandardIntegrityManager;
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest;
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityToken;
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider;
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest;

/**
 * Bridges Google's Play Integrity Standard API to the web layer so the native
 * build can attest itself on abuse-prone requests (sending an e-mail code) in
 * place of the Turnstile widget, which cannot run inside the app's
 * https://localhost webview.
 *
 * The JS side (src/lib/play-integrity.ts) calls requestToken with the linked
 * Cloud project number and a request hash (sha256 of the e-mail); this returns an
 * integrity token that the Worker decodes and verifies against Google.
 */
@CapacitorPlugin(name = "PlayIntegrity")
public class PlayIntegrityPlugin extends Plugin {

    /**
     * Cached token provider from prepareIntegrityToken. Preparing is the expensive
     * warm-up step and is meant to be done once and reused, so we hold the provider
     * across calls. Guarded together with tokenProviderProjectNumber so a changed
     * project number (should never happen at runtime) re-prepares.
     */
    private StandardIntegrityTokenProvider tokenProvider;
    private long tokenProviderProjectNumber;

    /**
     * Requests a Play Integrity token bound to a request hash.
     *
     * @param call Capacitor call carrying "projectNumber" (the linked Cloud project
     *             number, as a string to preserve the full 64-bit value) and
     *             "requestHash" (hex sha256 of the normalized e-mail). Resolves with
     *             { token } on success, or rejects with the failure reason.
     */
    @PluginMethod
    public void requestToken(PluginCall call) {
        String projectNumberStr = call.getString("projectNumber");
        String requestHash = call.getString("requestHash");
        if (projectNumberStr == null || requestHash == null) {
            call.reject("projectNumber and requestHash are required");
            return;
        }
        long projectNumber;
        try {
            projectNumber = Long.parseLong(projectNumberStr);
        } catch (NumberFormatException e) {
            call.reject("projectNumber must be a number");
            return;
        }

        // Reuse a warmed-up provider when we already have one for this project;
        // otherwise prepare it first, then issue the token request.
        StandardIntegrityTokenProvider provider = tokenProvider;
        if (provider != null && tokenProviderProjectNumber == projectNumber) {
            requestWithProvider(provider, requestHash, call);
            return;
        }
        prepareThenRequest(projectNumber, requestHash, call);
    }

    /**
     * Warms up a token provider for the given project number, caches it, then
     * issues the token request.
     *
     * @param projectNumber the linked Cloud project number.
     * @param requestHash   the request hash to bind the token to.
     * @param call          the Capacitor call to resolve or reject.
     */
    private void prepareThenRequest(long projectNumber, String requestHash, PluginCall call) {
        StandardIntegrityManager manager = IntegrityManagerFactory.createStandard(getContext());
        manager
            .prepareIntegrityToken(
                PrepareIntegrityTokenRequest.builder()
                    .setCloudProjectNumber(projectNumber)
                    .build()
            )
            .addOnSuccessListener(provider -> {
                tokenProvider = provider;
                tokenProviderProjectNumber = projectNumber;
                requestWithProvider(provider, requestHash, call);
            })
            .addOnFailureListener(e -> call.reject("integrity prepare failed: " + e.getMessage()));
    }

    /**
     * Issues an integrity token from an already-prepared provider.
     *
     * @param provider    the warmed-up token provider.
     * @param requestHash the request hash to bind the token to.
     * @param call        the Capacitor call to resolve or reject.
     */
    private void requestWithProvider(
        StandardIntegrityTokenProvider provider,
        String requestHash,
        PluginCall call
    ) {
        provider
            .request(
                StandardIntegrityTokenRequest.builder()
                    .setRequestHash(requestHash)
                    .build()
            )
            .addOnSuccessListener(response -> {
                JSObject ret = new JSObject();
                ret.put("token", response.token());
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.reject("integrity request failed: " + e.getMessage()));
    }
}
