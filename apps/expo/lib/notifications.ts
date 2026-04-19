import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerAndroid, registerApns } from './api';

// ---------------------------------------------------------------------------
// Foreground handler — show alerts + play sound while app is open
// ---------------------------------------------------------------------------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// Android notification channels — must be created at app startup before any
// push is shown. Android 8+ ignores importance/sound set elsewhere.
// ---------------------------------------------------------------------------
export async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // High priority: "You're being called", recall, buzz
  await Notifications.setNotificationChannelAsync('queue-alerts', {
    name: 'Queue Alerts',
    description: 'Your turn has arrived, recall or buzz from staff.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableLights: true,
    lightColor: '#1d4ed8',
  });

  // Default: position updates, serving, done
  await Notifications.setNotificationChannelAsync('queue-updates', {
    name: 'Queue Updates',
    description: 'Queue position changes and status updates.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 100],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

// ---------------------------------------------------------------------------
// Permission request
// ---------------------------------------------------------------------------
export async function requestPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });
  return status === 'granted';
}

// ---------------------------------------------------------------------------
// Token registration — call after joining a queue
// ---------------------------------------------------------------------------
export async function registerForPush(ticketId: string, qrToken?: string): Promise<boolean> {
  const granted = await requestPermissions();
  if (!granted) return false;

  try {
    if (Platform.OS === 'ios') {
      // Register raw APNs device token (for direct APNs delivery via our server)
      const token = await Notifications.getDevicePushTokenAsync();
      return registerApns({
        ticketId,
        deviceToken: token.data as string,
        kind: 'alert',
        environment: 'production',
        bundleId: 'com.qflo.app',
      });
    }

    if (Platform.OS === 'android') {
      const token = await Notifications.getDevicePushTokenAsync();
      const result = await registerAndroid({
        ticketId,
        qrToken,
        deviceToken: token.data as string,
        packageName: 'com.qflo.app',
      });
      return result.ok;
    }

    return false;
  } catch (err) {
    console.warn('[Notifications] registerForPush failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Appointment push — register after a successful booking so the customer gets
// instant APNs/Android push for approve / decline / cancel / no-show.
// ---------------------------------------------------------------------------
export async function registerForAppointmentPush(appointmentId: string): Promise<boolean> {
  const granted = await requestPermissions();
  if (!granted) return false;

  try {
    if (Platform.OS === 'ios') {
      const token = await Notifications.getDevicePushTokenAsync();
      return registerApns({
        appointmentId,
        deviceToken: token.data as string,
        kind: 'alert',
        environment: 'production',
        bundleId: 'com.qflo.app',
      });
    }

    if (Platform.OS === 'android') {
      const token = await Notifications.getDevicePushTokenAsync();
      const result = await registerAndroid({
        appointmentId,
        deviceToken: token.data as string,
        packageName: 'com.qflo.app',
      });
      return result.ok;
    }

    return false;
  } catch (err) {
    console.warn('[Notifications] registerForAppointmentPush failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Listeners — re-exported for use in _layout.tsx
// ---------------------------------------------------------------------------
export function addNotificationListener(
  handler: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(handler);
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

// ---------------------------------------------------------------------------
// Extract qrToken from a notification payload (works for both platforms)
// ---------------------------------------------------------------------------
export function getQrTokenFromData(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;

  // Android FCM data payload
  if (typeof data.qrToken === 'string' && data.qrToken) return data.qrToken;

  // iOS APNs url field: https://…/q/<token>
  if (typeof data.url === 'string') {
    const m = (data.url as string).match(/\/q\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
  }

  return null;
}
