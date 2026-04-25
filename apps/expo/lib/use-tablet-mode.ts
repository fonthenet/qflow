/**
 * useTabletMode
 *
 * Detects whether the device is a tablet (iPad or large-screen Android) and
 * exposes a per-device override stored in AsyncStorage under 'qflo_tablet_mode'.
 *
 * Values:
 *   null  → auto (default: use hardware detection)
 *   true  → forced on
 *   false → forced off
 *
 * isTablet: resolved value used by UI (auto-detect OR user override)
 */

import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'qflo_tablet_mode';

/** Hardware detection: iPad or Android tablet (shortest side >= 768 dp) */
function detectHardwareTablet(): boolean {
  if (Platform.OS === 'ios') {
    return Platform.isPad;
  }
  // Android: treat as tablet when the shortest side is >= 768 dp
  const { width, height } = Dimensions.get('window');
  return Math.min(width, height) >= 768;
}

export type TabletModeOverride = null | boolean;

interface TabletModeState {
  /** Resolved value — what the UI should actually use */
  isTablet: boolean;
  /** Raw override stored by the user (null = auto) */
  override: TabletModeOverride;
  /** Update the override and persist it */
  setOverride: (value: TabletModeOverride) => Promise<void>;
  /** Whether the initial AsyncStorage read is done */
  loaded: boolean;
}

export function useTabletMode(): TabletModeState {
  const hardwareTablet = detectHardwareTablet();
  const [override, setOverrideState] = useState<TabletModeOverride>(null);
  const [loaded, setLoaded] = useState(false);

  // Load persisted preference on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw === 'true') setOverrideState(true);
        else if (raw === 'false') setOverrideState(false);
        else setOverrideState(null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setOverride = async (value: TabletModeOverride) => {
    setOverrideState(value);
    if (value === null) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, String(value));
    }
  };

  const isTablet = override !== null ? override : hardwareTablet;

  return { isTablet, override, setOverride, loaded };
}
