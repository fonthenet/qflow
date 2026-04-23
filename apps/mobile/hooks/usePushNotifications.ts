/**
 * usePushNotifications — scaffold for Expo push notification registration.
 *
 * Rule: ALWAYS explain why before requesting permission.
 *       NEVER pre-request on first launch without showing the rationale screen.
 *
 * Flow:
 *   1. User opens Profile → taps "Enable notifications"
 *   2. App shows NotificationRationale screen (explains the value)
 *   3. User taps "Allow" → this hook's requestPermission() is called
 *   4. OS prompt appears
 *   5. On success, Expo push token is obtained and sent to the server
 *
 * TODO(web-engineer): Implement the `/api/push-token` edge function that
 *   stores the token against the customer's Supabase user_id or anonymous
 *   device_id. See apps/web edge functions for the pattern.
 *
 * TODO(mobile-sprint-3): Handle token refresh — Expo rotates push tokens
 *   after device restore. Use Notifications.addPushTokenListener() to detect
 *   rotation and re-register.
 */

import { useState, useEffect, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Show alerts + play sound while app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushPermissionStatus =
  | 'undetermined'
  | 'granted'
  | 'denied'
  | 'requesting';

interface PushNotificationState {
  permissionStatus: PushPermissionStatus;
  expoPushToken: string | null;
  isRegistering: boolean;
  error: string | null;
}

interface PushNotificationActions {
  /**
   * Request push permission and obtain the Expo push token.
   * Call this ONLY after showing the rationale screen to the user.
   */
  requestPermission: () => Promise<void>;
}

async function createAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('queue-alerts', {
    name: 'Queue Alerts',
    description: 'Alerts when your turn arrives or staff calls you.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1d4ed8',
  });

  await Notifications.setNotificationChannelAsync('appointment-reminders', {
    name: 'Appointment Reminders',
    description: 'Reminders before your scheduled appointments.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

export function usePushNotifications(): PushNotificationState &
  PushNotificationActions {
  const [permissionStatus, setPermissionStatus] =
    useState<PushPermissionStatus>('undetermined');
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check existing permission status on mount (without triggering OS prompt)
  useEffect(() => {
    Notifications.getPermissionsAsync().then(({ status }) => {
      if (status === 'granted') setPermissionStatus('granted');
      else if (status === 'denied') setPermissionStatus('denied');
      // else: undetermined — wait for explicit user action
    });

    // Create Android channels at startup so notifications render correctly
    // even if the app hasn't asked for permission yet.
    createAndroidChannels();
  }, []);

  const requestPermission = useCallback(async (): Promise<void> => {
    if (permissionStatus === 'granted' || isRegistering) return;

    setIsRegistering(true);
    setPermissionStatus('requesting');
    setError(null);

    try {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      });

      if (status !== 'granted') {
        setPermissionStatus('denied');
        return;
      }

      setPermissionStatus('granted');

      // Obtain the Expo push token (requires a physical device for APNs/FCM)
      const tokenResult = await Notifications.getExpoPushTokenAsync({
        // TODO: set projectId from EAS config once eas init is run
        // projectId: Constants.expoConfig?.extra?.eas?.projectId,
      });

      setExpoPushToken(tokenResult.data);

      // TODO(web-engineer): POST tokenResult.data to /api/push-token
      // along with the authenticated user's supabase_user_id so the server
      // can target notifications to this device.
      // Example:
      //   await supabase.functions.invoke('register-push-token', {
      //     body: { token: tokenResult.data, platform: Platform.OS },
      //   });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Push registration failed';
      setError(message);
    } finally {
      setIsRegistering(false);
    }
  }, [permissionStatus, isRegistering]);

  return {
    permissionStatus,
    expoPushToken,
    isRegistering,
    error,
    requestPermission,
  };
}
