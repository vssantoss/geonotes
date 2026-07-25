package app.vshub.gnotes;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the local Play Integrity bridge before the Capacitor bridge
        // starts, so the web layer can call PlayIntegrity.requestToken.
        registerPlugin(PlayIntegrityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
