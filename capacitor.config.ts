import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.vshub.gnotes',
  appName: 'GeoNotes',
  webDir: 'dist',
  // Marks the WebView's user agent so the server can tell a request from the
  // app apart from one from a browser. The WebView shares an engine with
  // Chrome and is otherwise indistinguishable from it, which made passkeys
  // enrolled in the app show up as "Chrome" in settings. Read only by
  // deviceLabel() in src/lib/ua.ts, for display.
  appendUserAgent: 'GeoNotesApp'
};

export default config;
