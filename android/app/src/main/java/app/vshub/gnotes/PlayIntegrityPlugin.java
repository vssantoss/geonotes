package app.vshub.gnotes;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.tasks.Task;
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
 *
 * The two steps have very different costs: preparing a token provider took 864ms
 * on the dev emulator while issuing a token from a prepared one took 9ms. So the
 * JS side calls warmUp at app start and the prepare is over long before the user
 * asks for an e-mail code. Preparing binds to the Play Store service and consumes
 * no token quota, which is why doing it ahead of time is Google's guidance.
 */
@CapacitorPlugin(name = "PlayIntegrity")
public class PlayIntegrityPlugin extends Plugin {

    /**
     * Cached token provider from prepareIntegrityToken. Preparing is the expensive
     * warm-up step and is meant to be done once and reused, so we hold the provider
     * across calls. Guarded together with tokenProviderProjectNumber so a changed
     * project number (should never happen at runtime) re-prepares. Cleared when a
     * token request fails, since Play can invalidate a prepared provider and a
     * stale one would fail every later call (see requestWithProvider).
     */
    private StandardIntegrityTokenProvider tokenProvider;
    private long tokenProviderProjectNumber;

    /**
     * Prepares and caches a token provider ahead of any token request, so the
     * expensive step does not land on the user's tap. Safe to call repeatedly: a
     * provider already cached for this project number is kept.
     *
     * @param call Capacitor call carrying "projectNumber". Resolves once a provider
     *             is cached, or rejects if preparing failed. Callers treat it as
     *             advisory; requestToken prepares on its own if this never ran.
     */
    @PluginMethod
    public void warmUp(PluginCall call) {
        Long projectNumber = parseProjectNumber(call);
        if (projectNumber == null) return;

        if (tokenProvider != null && tokenProviderProjectNumber == projectNumber) {
            call.resolve();
            return;
        }
        prepareProvider(projectNumber)
            .addOnSuccessListener(provider -> {
                cacheProvider(provider, projectNumber);
                call.resolve();
            })
            .addOnFailureListener(e -> call.reject("integrity prepare failed: " + e.getMessage()));
    }

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
        String requestHash = call.getString("requestHash");
        if (requestHash == null) {
            call.reject("requestHash is required");
            return;
        }
        Long projectNumberBoxed = parseProjectNumber(call);
        if (projectNumberBoxed == null) return;
        long projectNumber = projectNumberBoxed;

        // Reuse a warmed-up provider when we already have one for this project;
        // otherwise prepare it first, then issue the token request. A cached
        // provider may have been invalidated since it was prepared, so its
        // request is allowed one re-prepare; a freshly prepared one is not.
        StandardIntegrityTokenProvider provider = tokenProvider;
        if (provider != null && tokenProviderProjectNumber == projectNumber) {
            requestWithProvider(provider, projectNumber, requestHash, call, true);
            return;
        }
        prepareThenRequest(projectNumber, requestHash, call);
    }

    /**
     * Reads and validates the "projectNumber" argument, rejecting the call when it
     * is missing or not a number.
     *
     * @param call the Capacitor call to read from and reject on bad input.
     * @return the project number, or null when the call was rejected.
     */
    private Long parseProjectNumber(PluginCall call) {
        String value = call.getString("projectNumber");
        if (value == null) {
            call.reject("projectNumber is required");
            return null;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            call.reject("projectNumber must be a number");
            return null;
        }
    }

    /**
     * Starts the prepare (warm-up) step for a project number. This is the slow
     * half of the API, so both callers go through it rather than duplicating it.
     *
     * @param projectNumber the linked Cloud project number.
     * @return the pending prepare task, to attach listeners to.
     */
    private Task<StandardIntegrityTokenProvider> prepareProvider(long projectNumber) {
        StandardIntegrityManager manager = IntegrityManagerFactory.createStandard(getContext());
        return manager.prepareIntegrityToken(
            PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(projectNumber).build()
        );
    }

    /**
     * Caches a freshly prepared provider together with the project number it was
     * prepared for.
     *
     * @param provider      the prepared token provider.
     * @param projectNumber the project number it belongs to.
     */
    private void cacheProvider(StandardIntegrityTokenProvider provider, long projectNumber) {
        tokenProvider = provider;
        tokenProviderProjectNumber = projectNumber;
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
        prepareProvider(projectNumber)
            .addOnSuccessListener(provider -> {
                cacheProvider(provider, projectNumber);
                // Already prepared as freshly as we can, so a failure here is real:
                // no further re-prepare.
                requestWithProvider(provider, projectNumber, requestHash, call, false);
            })
            .addOnFailureListener(e -> call.reject("integrity prepare failed: " + e.getMessage()));
    }

    /**
     * Issues an integrity token from an already-prepared provider.
     *
     * A prepared provider does not stay valid forever (Play can invalidate it,
     * e.g. INTEGRITY_TOKEN_PROVIDER_INVALID), so a failure drops the cached one:
     * keeping it would make every later call in this app session fail the same
     * way, which the JS layer turns into a null token and the Worker into a 403,
     * blocking account creation and recovery until the app is restarted.
     *
     * @param provider        the warmed-up token provider.
     * @param projectNumber   the linked Cloud project number, needed to re-prepare.
     * @param requestHash     the request hash to bind the token to.
     * @param call            the Capacitor call to resolve or reject.
     * @param retryOnFailure  whether a failure may re-prepare and try once more,
     *                        which is only sound for a provider that came from the
     *                        cache; false stops a prepare/request failure loop.
     */
    private void requestWithProvider(
        StandardIntegrityTokenProvider provider,
        long projectNumber,
        String requestHash,
        PluginCall call,
        boolean retryOnFailure
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
            .addOnFailureListener(e -> {
                // Only drop the provider we actually used; a concurrent call may
                // already have cached a newer one.
                if (tokenProvider == provider) {
                    tokenProvider = null;
                }
                if (retryOnFailure) {
                    prepareThenRequest(projectNumber, requestHash, call);
                    return;
                }
                call.reject("integrity request failed: " + e.getMessage());
            });
    }
}
