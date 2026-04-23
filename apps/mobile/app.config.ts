import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Qflo',
  slug: 'qflo-customer',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'qflo',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#1d4ed8',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.qflo.app',
    infoPlist: {
      NSCameraUsageDescription:
        'Qflo uses the camera to scan QR codes at service locations.',
      NSFaceIDUsageDescription:
        'Qflo uses Face ID to protect your profile and booking history.',
      NSUserNotificationsUsageDescription:
        'Qflo sends notifications to alert you when your turn is approaching.',
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ['remote-notification'],
    },
    // Universal links — apple-app-site-association at apps/web/public/.well-known/
    // must be deployed and APPLE_TEAM_ID placeholder filled before App Store submission.
    associatedDomains: ['applinks:qflo.app', 'applinks:www.qflo.app'],
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#1d4ed8',
    },
    package: 'com.qflo.app',
    permissions: [
      'CAMERA',
      'NOTIFICATIONS',
      'POST_NOTIFICATIONS',
      'RECEIVE_BOOT_COMPLETED',
      'VIBRATE',
      'USE_BIOMETRIC',
      'USE_FINGERPRINT',
    ],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    // App Links — autoVerify requires /.well-known/assetlinks.json on qflo.app.
    // ANDROID_SHA256_FINGERPRINT placeholder must be filled before Play Store submission.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'qflo.app', pathPrefix: '/q/' },
          { scheme: 'https', host: 'qflo.app', pathPrefix: '/book/' },
          { scheme: 'https', host: 'qflo.app', pathPrefix: '/scan/' },
          { scheme: 'https', host: 'qflo.app', pathPrefix: '/join/' },
          { scheme: 'https', host: 'qflo.app', pathPrefix: '/kiosk/' },
          { scheme: 'https', host: 'www.qflo.app', pathPrefix: '/q/' },
          { scheme: 'https', host: 'www.qflo.app', pathPrefix: '/book/' },
          { scheme: 'https', host: 'www.qflo.app', pathPrefix: '/scan/' },
          { scheme: 'https', host: 'www.qflo.app', pathPrefix: '/join/' },
          { scheme: 'https', host: 'www.qflo.app', pathPrefix: '/kiosk/' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    bundler: 'metro',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    'expo-localization',
    [
      'expo-camera',
      {
        cameraPermission: 'Qflo needs camera access to scan QR codes.',
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'Qflo uses Face ID to secure access to your profile.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/icon.png',
        color: '#1d4ed8',
        defaultChannel: 'queue-updates',
        sounds: [],
      },
    ],
    [
      'expo-build-properties',
      {
        ios: {
          privacyManifests: {
            NSPrivacyAccessedAPITypes: [
              {
                NSPrivacyAccessedAPIType:
                  'NSPrivacyAccessedAPICategoryUserDefaults',
                NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
              },
              {
                NSPrivacyAccessedAPIType:
                  'NSPrivacyAccessedAPICategoryFileTimestamp',
                NSPrivacyAccessedAPITypeReasons: ['C617.1'],
              },
              {
                NSPrivacyAccessedAPIType:
                  'NSPrivacyAccessedAPICategoryDiskSpace',
                NSPrivacyAccessedAPITypeReasons: ['E174.1'],
              },
              {
                NSPrivacyAccessedAPIType:
                  'NSPrivacyAccessedAPICategorySystemBootTime',
                NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
              },
            ],
          },
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
    // Run `eas init` once to replace this placeholder with the real project UUID.
    eas: { projectId: '{{EAS_PROJECT_ID}}' },
  },
});
