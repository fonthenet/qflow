/**
 * Expo config plugin for react-native-zeroconf.
 *
 * iOS: Adds NSLocalNetworkUsageDescription + NSBonjourServices to Info.plist
 * Android: Ensures usesCleartextTraffic is true (already set by default in debug)
 */
const { withInfoPlist, withAndroidManifest } = require('expo/config-plugins');

function withZeroconf(config) {
  // ── iOS ────────────────────────────────────────────────────────
  config = withInfoPlist(config, (mod) => {
    // Permission prompt text when the app accesses local network
    if (!mod.modResults.NSLocalNetworkUsageDescription) {
      mod.modResults.NSLocalNetworkUsageDescription =
        'This app searches your local network to find and connect to Qflo Station for queue management.';
    }

    // Register Bonjour service types we browse for
    const bonjourServices = mod.modResults.NSBonjourServices || [];
    const required = ['_qflo._tcp.'];
    for (const svc of required) {
      if (!bonjourServices.includes(svc)) {
        bonjourServices.push(svc);
      }
    }
    mod.modResults.NSBonjourServices = bonjourServices;

    return mod;
  });

  // ── Android ────────────────────────────────────────────────────
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) {
      // Allow cleartext HTTP traffic on local network
      app.$['android:usesCleartextTraffic'] = 'true';
    }
    return mod;
  });

  return config;
}

module.exports = withZeroconf;
