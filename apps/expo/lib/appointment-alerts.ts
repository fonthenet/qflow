/**
 * Appointment lifecycle alerts for the customer.
 *
 * The mobile app polls the server every 20s (when focused) and on pull-to-
 * refresh. When it notices an appointment transitioned to a new status, we
 * fire a local system notification + haptic so the customer finds out
 * immediately — even if the app is backgrounded (the local notification
 * shows on the lockscreen just like a push).
 *
 * This is the mobile equivalent of the WhatsApp templates
 * `approval_approved`, `approval_declined`, `appointment_cancelled`,
 * `appointment_no_show`, `booking_reminder`, etc. — the user now gets
 * parity messaging whether they booked by WhatsApp, web, or mobile.
 *
 * Phase 2 (server-side APNs/Android push keyed by appointment_id) will
 * replace polling with true push; this polling fallback is what ships
 * today so the feature works without a web deploy + mobile rebuild.
 */

import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

type T = (key: string, opts?: any) => string;

export interface AppointmentAlertContext {
  previousStatus: string | undefined;
  nextStatus: string;
  businessName?: string | null;
  t: T;
}

/** Maps a status transition to { title, body } the user sees. Returns null
 *  when the transition isn't worth alerting on (e.g. no change, or a silent
 *  internal reshuffle like pending→pending). */
function resolveAlert(ctx: AppointmentAlertContext): { title: string; body: string; channel: 'queue-alerts' | 'queue-updates' } | null {
  const { previousStatus, nextStatus, businessName, t } = ctx;
  if (!previousStatus || previousStatus === nextStatus) return null;

  const biz = businessName || t('common.business', { defaultValue: 'the business' });

  // Approved (pending → confirmed)
  if (previousStatus === 'pending' && nextStatus === 'confirmed') {
    return {
      title: t('apptAlert.approvedTitle', { defaultValue: 'Appointment approved' }),
      body: t('apptAlert.approvedBody', { defaultValue: `${biz} confirmed your appointment.`, business: biz }),
      channel: 'queue-alerts',
    };
  }

  // Declined (pending → declined / cancelled)
  if (previousStatus === 'pending' && (nextStatus === 'declined' || nextStatus === 'cancelled')) {
    return {
      title: t('apptAlert.declinedTitle', { defaultValue: 'Appointment declined' }),
      body: t('apptAlert.declinedBody', { defaultValue: `${biz} couldn't confirm your appointment.`, business: biz }),
      channel: 'queue-alerts',
    };
  }

  // Cancelled (confirmed → cancelled) — staff-initiated cancel
  if (previousStatus === 'confirmed' && nextStatus === 'cancelled') {
    return {
      title: t('apptAlert.cancelledTitle', { defaultValue: 'Appointment cancelled' }),
      body: t('apptAlert.cancelledBody', { defaultValue: `${biz} cancelled your appointment.`, business: biz }),
      channel: 'queue-alerts',
    };
  }

  // Marked no-show (anything → no_show)
  if (nextStatus === 'no_show') {
    return {
      title: t('apptAlert.noShowTitle', { defaultValue: 'Marked as missed' }),
      body: t('apptAlert.noShowBody', { defaultValue: `${biz} marked your appointment as missed.`, business: biz }),
      channel: 'queue-alerts',
    };
  }

  // Checked in (→ checked_in) — staff issued the linked ticket
  if (nextStatus === 'checked_in') {
    return {
      title: t('apptAlert.checkedInTitle', { defaultValue: "You're in the queue" }),
      body: t('apptAlert.checkedInBody', { defaultValue: `${biz} checked you in for your appointment.`, business: biz }),
      channel: 'queue-updates',
    };
  }

  // Serving (→ serving)
  if (nextStatus === 'serving') {
    return {
      title: t('apptAlert.servingTitle', { defaultValue: "It's your turn" }),
      body: t('apptAlert.servingBody', { defaultValue: `${biz} is serving you now.`, business: biz }),
      channel: 'queue-alerts',
    };
  }

  // Completed (→ completed)
  if (nextStatus === 'completed') {
    return {
      title: t('apptAlert.completedTitle', { defaultValue: 'Appointment completed' }),
      body: t('apptAlert.completedBody', { defaultValue: `Thanks for visiting ${biz}.`, business: biz }),
      channel: 'queue-updates',
    };
  }

  return null;
}

/** Fires a local system notification + haptic for an appointment transition.
 *  Safe to call from anywhere — silently no-ops when the transition doesn't
 *  have a message. */
export async function notifyAppointmentStatusChange(ctx: AppointmentAlertContext): Promise<void> {
  const alert = resolveAlert(ctx);
  if (!alert) return;

  // Haptic — warning for blocking news (declined/cancelled/no_show), success
  // for positive news, soft tick for neutral.
  const bad = ['declined', 'cancelled', 'no_show'].includes(ctx.nextStatus);
  const good = ['confirmed', 'serving', 'completed'].includes(ctx.nextStatus);
  try {
    if (bad) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (good) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Haptics.selectionAsync();
  } catch {
    // Haptics aren't available on every device — ignore.
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: alert.title,
        body: alert.body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        ...(Platform.OS === 'android' ? { channelId: alert.channel } : {}),
      },
      trigger: null, // present immediately
    });
  } catch {
    // If the user denied notification permission we silently drop — the
    // status pill in the Activité tab is the fallback surface.
  }
}
