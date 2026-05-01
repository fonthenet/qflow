/**
 * Background location task for the Qflo rider app.
 *
 * Foreground OR background, screen on OR locked, GPS streams to the
 * customer's tracking page via /api/rider/heartbeat. This is the
 * native edge over the web portal: web pauses GPS the moment the tab
 * is hidden; the native task survives lock + background.
 *
 * Why a TaskManager-defined task: expo-location's
 * `Location.startLocationUpdatesAsync(taskName, …)` registers the OS
 * to wake the app on each location fix even when JS is suspended.
 * The task body fires per-fix; we throttle the network POST to ~5 s
 * to match the web portal's heartbeat cadence (and limit data use).
 *
 * Lifecycle:
 *   - rider screen mounts with a (ticketId, token) → calls
 *     `startRiderLocationStream({ ticketId, token })`
 *   - rider taps DELIVERED, ARRIVED+DELIVERED, or operator unassigns:
 *     server replies `{ stopped: true }` on the next heartbeat → task
 *     stops itself via `stopRiderLocationStream()`
 *   - on screen unmount we call `stopRiderLocationStream()` defensively
 *     (idempotent — no-op if already stopped)
 *
 * The active ticketId + token are stashed in AsyncStorage so the
 * background task body can read them without React state. This is the
 * standard pattern documented in the expo-location README — JS
 * context isolated from the foreground React tree.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { postHeartbeat } from './rider-api';

export const RIDER_LOCATION_TASK = 'qflo-rider-location';

const STORAGE_KEY = 'qflo:rider-task-ctx';
// Min gap between successful POSTs. The OS may emit fixes faster (1 Hz
// while moving); we send at most 1 every HEARTBEAT_MIN_MS so the
// customer map gets sub-10s freshness without thrashing the rider's
// data plan or our cron.
const HEARTBEAT_MIN_MS = 5_000;
const LAST_SENT_KEY = 'qflo:rider-last-sent-ms';

interface RiderTaskContext {
  ticketId: string;
  token: string;
}

/**
 * Defines the global background task. Must run at module-load time
 * (before any startLocationUpdatesAsync call) because expo-task-manager
 * resolves task names at task fire time. The actual task body just
 * reads the stored ticket context, throttles, and POSTs.
 */
TaskManager.defineTask(RIDER_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[rider-location-task] error', error.message);
    return;
  }
  const payload = data as { locations?: Location.LocationObject[] } | undefined;
  const fix = payload?.locations?.[0];
  if (!fix) return;

  // Look up the active ticket context. If there isn't one, the task
  // shouldn't even be running — stop it defensively.
  let ctx: RiderTaskContext | null = null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) ctx = JSON.parse(raw) as RiderTaskContext;
  } catch { /* fall through */ }
  if (!ctx?.ticketId || !ctx?.token) {
    try {
      const running = await Location.hasStartedLocationUpdatesAsync(RIDER_LOCATION_TASK);
      if (running) await Location.stopLocationUpdatesAsync(RIDER_LOCATION_TASK);
    } catch { /* ignore */ }
    return;
  }

  // Throttle network sends — OS fix cadence is faster than we want
  // to push to the server.
  const now = Date.now();
  try {
    const lastRaw = await AsyncStorage.getItem(LAST_SENT_KEY);
    const last = lastRaw ? Number(lastRaw) : 0;
    if (Number.isFinite(last) && now - last < HEARTBEAT_MIN_MS) return;
  } catch { /* fall through */ }

  // Sanity-bound the fix. Some OS coalesce produces (0,0) on cold
  // boot — don't push that to the customer map.
  const { latitude, longitude, accuracy, heading, speed } = fix.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  if (latitude === 0 && longitude === 0) return;

  try {
    const r = await postHeartbeat({
      ticketId: ctx.ticketId,
      token: ctx.token,
      lat: latitude,
      lng: longitude,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      heading: typeof heading === 'number' ? heading : null,
      speed: typeof speed === 'number' ? speed : null,
    });
    await AsyncStorage.setItem(LAST_SENT_KEY, String(now));
    if (r?.stopped) {
      // Server signal: order is done — stop the task and clear state.
      await stopRiderLocationStream();
    }
  } catch (e: any) {
    // Network blip — don't update LAST_SENT so the next fix retries
    // without waiting another HEARTBEAT_MIN_MS.
    console.warn('[rider-location-task] heartbeat failed', e?.message);
  }
});

export interface StartStreamResult {
  ok: boolean;
  /** Permission state we end up in. 'granted' = both foreground + bg
   *  granted on Android (or always-allow on iOS); 'foreground' = only
   *  while-using granted (works while app is foreground but stops on
   *  lock); 'denied' = nothing. */
  permission: 'granted' | 'foreground' | 'denied' | 'unavailable';
  error?: string;
}

/**
 * Request both foreground + background location permissions, persist
 * the active rider context, and start the OS-level location updates
 * task. Idempotent — calling twice with different tickets swaps the
 * context atomically.
 *
 * Returns the permission state so the rider screen can show a clear
 * banner ("granted = streaming live", "foreground only = pauses on
 * lock", "denied = manual location-share required").
 */
export async function startRiderLocationStream(ctx: RiderTaskContext): Promise<StartStreamResult> {
  // 1. Foreground permission first — required before bg-permission
  //    even shows up in the OS dialog.
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { ok: false, permission: 'denied', error: fg.canAskAgain ? 'permission_denied' : 'permission_blocked' };
  }

  // 2. Background permission — second OS dialog. iOS may show "Always
  //    Allow" only after the user has used the app foreground for a bit.
  let bgGranted = true;
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    bgGranted = bg.status === 'granted';
  } catch {
    // Some devices (e.g. older Androids) error out — treat as denied.
    bgGranted = false;
  }

  // 3. Persist context BEFORE starting updates so the first task fire
  //    has it.
  await AsyncStorage.multiSet([
    [STORAGE_KEY, JSON.stringify(ctx)],
    [LAST_SENT_KEY, '0'],
  ]);

  // 4. Stop any previous task (e.g. from a stale rider screen). The
  //    SDK throws if you call start while one is running, so we always
  //    stop-first.
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(RIDER_LOCATION_TASK);
    if (running) await Location.stopLocationUpdatesAsync(RIDER_LOCATION_TASK);
  } catch { /* ignore */ }

  // 5. Start the OS-driven updates. accuracy: BestForNavigation gives
  //    sub-10m fixes when GPS is healthy; fallback to High when the
  //    device declines. distanceInterval: 10 m means a fix per 10m of
  //    movement (saves battery while parked at a light). timeInterval
  //    on Android caps it at ~5 s as a safety net. iOS ignores
  //    timeInterval but the OS coalesces aggressively itself.
  try {
    await Location.startLocationUpdatesAsync(RIDER_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: Platform.OS === 'android' ? 5_000 : undefined,
      distanceInterval: 10,
      // Foreground service notification — Android REQUIRES this for
      // background location on API 26+. iOS shows its own blue bar.
      foregroundService: {
        notificationTitle: 'Qflo — delivering',
        notificationBody: 'Sharing your live location with the customer.',
        notificationColor: '#1d4ed8',
      },
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: true,
    });
  } catch (e: any) {
    // Roll back the stored context so a stale task body doesn't fire
    // against the wrong ticket later.
    await AsyncStorage.multiRemove([STORAGE_KEY, LAST_SENT_KEY]);
    return { ok: false, permission: bgGranted ? 'granted' : 'foreground', error: e?.message ?? 'start_failed' };
  }

  return { ok: true, permission: bgGranted ? 'granted' : 'foreground' };
}

/**
 * Stop the location task and clear the stored rider context.
 * Idempotent — safe to call from screen unmount even if the task
 * was never started.
 */
export async function stopRiderLocationStream(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(RIDER_LOCATION_TASK);
    if (running) await Location.stopLocationUpdatesAsync(RIDER_LOCATION_TASK);
  } catch { /* ignore */ }
  try {
    await AsyncStorage.multiRemove([STORAGE_KEY, LAST_SENT_KEY]);
  } catch { /* ignore */ }
}

/**
 * Check whether a location stream is currently active. Used by the
 * rider home screen to render a "Currently delivering #FIX-0113"
 * banner across app launches.
 */
export async function isRiderLocationStreaming(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(RIDER_LOCATION_TASK);
  } catch {
    return false;
  }
}

/**
 * Read the active rider context (ticketId + token) without starting
 * anything. Useful for the home screen to decide where to deeplink
 * the operator on cold launch ("you have a delivery in progress").
 */
export async function getActiveRiderContext(): Promise<RiderTaskContext | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.ticketId && parsed?.token) return parsed as RiderTaskContext;
  } catch { /* fall through */ }
  return null;
}
