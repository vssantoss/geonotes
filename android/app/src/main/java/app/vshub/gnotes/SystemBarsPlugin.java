package app.vshub.gnotes;

import android.app.Activity;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web layer tell Android which way the status bar and navigation bar
 * icons should be drawn.
 *
 * From targetSdk 35 the app is edge-to-edge and both bars are transparent, so
 * what shows behind them is the page's own background. The clock, battery and
 * signal icons are drawn by the system, though, and it has no idea what colour
 * that background is: without being told, it keeps the light (white) icons the
 * theme starts with, which vanish against the light theme's near-white
 * background.
 *
 * The app's appearance is a web-layer choice (a stored preference that can
 * differ from the system's dark mode), so a resource qualifier such as
 * values-night cannot answer this. src/lib/theme.tsx calls in whenever the
 * resolved appearance changes.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    /**
     * Sets the system bar icons to suit the background they sit on.
     *
     * @param call Capacitor call carrying "dark": whether the app is currently
     *             showing its dark appearance. Dark backgrounds take light
     *             icons and light backgrounds take dark ones, so the flag is
     *             inverted for the "appearance light bars" the platform asks
     *             for. Resolves once applied; rejects if "dark" is missing.
     */
    @PluginMethod
    public void setAppearance(PluginCall call) {
        Boolean dark = call.getBoolean("dark");
        if (dark == null) {
            call.reject("dark is required");
            return;
        }
        // Light icons on a dark app, dark icons on a light one.
        final boolean lightBars = !dark;
        final Activity activity = getActivity();
        // Window flags may only be touched from the UI thread; plugin calls
        // arrive on the bridge's thread.
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                window,
                window.getDecorView()
            );
            controller.setAppearanceLightStatusBars(lightBars);
            // The navigation bar matters for three-button navigation, where the
            // system draws real icons over the page; the gesture pill tints
            // itself and is unaffected either way.
            controller.setAppearanceLightNavigationBars(lightBars);
            call.resolve();
        });
    }
}
