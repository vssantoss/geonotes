package app.vshub.gnotes;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the local Play Integrity bridge before the Capacitor bridge
        // starts, so the web layer can call PlayIntegrity.requestToken.
        registerPlugin(PlayIntegrityPlugin.class);
        // Same for the system bars, which the theme calls into as soon as it
        // resolves the appearance on first paint.
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
