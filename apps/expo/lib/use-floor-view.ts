/**
 * useFloorView
 *
 * Manages the Queue ↔ Tables (floor map) toggle for restaurant/cafe operators.
 * Persists the last-chosen view in AsyncStorage so it survives reload.
 *
 * Only active when the org's business_category is 'restaurant' or 'cafe'.
 * isRestaurantCategory must be passed by the caller (derived from the org row).
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type FloorViewMode = 'queue' | 'floor';

const STORAGE_KEY = 'qflo_operator_floor_view';

const RESTAURANT_CATEGORIES = new Set(['restaurant', 'cafe']);

interface FloorViewState {
  /** Whether this org supports the floor view toggle at all */
  supportsFloorView: boolean;
  /** Current view mode */
  mode: FloorViewMode;
  /** Toggle between queue and floor */
  toggle: () => void;
  /** Directly set the mode */
  setMode: (mode: FloorViewMode) => void;
}

export function useFloorView(businessCategory: string | null): FloorViewState {
  const supportsFloorView = businessCategory !== null && RESTAURANT_CATEGORIES.has(businessCategory);
  const [mode, setModeState] = useState<FloorViewMode>('queue');

  // Load persisted mode on mount
  useEffect(() => {
    if (!supportsFloorView) return;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw === 'floor') setModeState('floor');
      })
      .catch(() => {});
  }, [supportsFloorView]);

  const setMode = useCallback((next: FloorViewMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === 'queue' ? 'floor' : 'queue');
  }, [mode, setMode]);

  return { supportsFloorView, mode, toggle, setMode };
}
