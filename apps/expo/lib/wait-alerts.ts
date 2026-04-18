/**
 * Wait-alert polling service.
 *
 * For each SavedPlace with `waitAlertThreshold` set, periodically fetch the
 * queue status and fire a local notification when the waiting count is at or
 * below the user's threshold. Debounced per-place to once every 30 min so we
 * don't spam the user while the queue oscillates around the threshold.
 *
 * Initialised once from app/_layout.tsx. Pauses when the app goes to
 * background to save battery and re-ticks when it returns to foreground.
 */
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import i18n from './i18n';
import { useAppStore } from './store';
import { fetchQueueStatus } from './api';

/** How often to check (ms). 5 min is a reasonable cadence — alerts aren't time-critical. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum gap between two alerts for the same place (ms). */
const DEBOUNCE_MS = 30 * 60 * 1000;

let interval: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;

async function tick(): Promise<void> {
  const { savedPlaces, markWaitAlertFired, markPlaceOk, markPlaceFailed } =
    useAppStore.getState();

  // Only consider places with a threshold AND a kioskSlug (queue-status
  // requires the slug — join-token-only places can't be polled this way).
  const watched = savedPlaces.filter(
    (p) => typeof p.waitAlertThreshold === 'number' && p.kioskSlug,
  );
  if (watched.length === 0) return;

  const now = Date.now();

  await Promise.all(
    watched.map(async (place) => {
      if (!place.kioskSlug) return;
      const status = await fetchQueueStatus(place.kioskSlug);
      if (!status) {
        markPlaceFailed(place.id);
        return;
      }
      markPlaceOk(place.id);

      const threshold = place.waitAlertThreshold!;
      const waiting = status.totalWaiting;
      if (waiting > threshold) return;

      // Debounce
      const lastFired = place.waitAlertLastFiredAt
        ? new Date(place.waitAlertLastFiredAt).getTime()
        : 0;
      if (now - lastFired < DEBOUNCE_MS) return;

      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: i18n.t('places.waitAlertNotificationTitle', { name: place.name }),
            body: i18n.t('places.waitAlertNotificationBody', { count: waiting }),
            data: {
              kind: 'wait-alert',
              placeId: place.id,
              kioskSlug: place.kioskSlug,
            },
          },
          trigger: null, // fire immediately
        });
        markWaitAlertFired(place.id);
      } catch (err) {
        if (__DEV__) console.warn('[wait-alerts] notification failed', err);
      }
    }),
  );
}

function handleAppStateChange(next: AppStateStatus): void {
  if (next === 'active') {
    // Run immediately on foreground + resume ticking
    void tick();
    if (!interval) {
      interval = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    }
  } else {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }
}

/** Start the background wait-alert loop. Idempotent. */
export function startWaitAlerts(): () => void {
  if (appStateSub) return stopWaitAlerts;

  // Kick immediately if the app is already active
  if (AppState.currentState === 'active') {
    void tick();
    interval = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
  }
  appStateSub = AppState.addEventListener('change', handleAppStateChange);

  return stopWaitAlerts;
}

export function stopWaitAlerts(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
}

/** Fire a tick on demand (e.g. from pull-to-refresh in Places). */
export function checkWaitAlertsNow(): Promise<void> {
  return tick();
}
