import { useColorScheme } from 'react-native';

// ---------------------------------------------------------------------------
// Color palettes
// ---------------------------------------------------------------------------

export const lightColors = {
  primary: '#1d4ed8',
  primaryLight: '#3b82f6',
  primaryDark: '#1e40af',

  background: '#f8fafc',
  surface: '#ffffff',
  surfaceSecondary: '#f1f5f9',

  text: '#0f172a',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',

  border: '#e2e8f0',
  borderLight: '#f1f5f9',

  success: '#22c55e',
  successLight: '#f0fdf4',
  warning: '#f59e0b',
  warningLight: '#fffbeb',
  error: '#ef4444',
  errorLight: '#fef2f2',
  info: '#3b82f6',
  infoLight: '#eff6ff',

  waiting: '#3b82f6',
  waitingBg: '#eff6ff',
  called: '#f59e0b',
  calledBg: '#fffbeb',
  serving: '#22c55e',
  servingBg: '#f0fdf4',
  done: '#94a3b8',
  doneBg: '#f8fafc',
};

export const darkColors: typeof lightColors = {
  primary: '#3b82f6',
  primaryLight: '#60a5fa',
  primaryDark: '#2563eb',

  background: '#0f172a',
  surface: '#1e293b',
  surfaceSecondary: '#0f172a',

  text: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',

  border: '#334155',
  borderLight: '#1e293b',

  success: '#22c55e',
  successLight: 'rgba(34,197,94,0.12)',
  warning: '#f59e0b',
  warningLight: 'rgba(245,158,11,0.12)',
  error: '#ef4444',
  errorLight: 'rgba(239,68,68,0.12)',
  info: '#60a5fa',
  infoLight: 'rgba(96,165,250,0.12)',

  waiting: '#60a5fa',
  waitingBg: 'rgba(96,165,250,0.12)',
  called: '#fbbf24',
  calledBg: 'rgba(251,191,36,0.12)',
  serving: '#34d399',
  servingBg: 'rgba(52,211,153,0.12)',
  done: '#64748b',
  doneBg: 'rgba(100,116,139,0.12)',
};

export type ThemeColors = typeof lightColors;

/** Backward-compat alias — defaults to light. */
export const colors = lightColors;

// ---------------------------------------------------------------------------
// useTheme hook — respects system preference
// ---------------------------------------------------------------------------

/**
 * Returns the active color palette and a boolean indicating dark mode.
 *
 * Theme preference can be overridden by the user in the Profile screen.
 * TODO: wire themeMode ('system' | 'light' | 'dark') to a zustand store
 *   so the Profile screen toggle persists across sessions.
 */
export function useTheme(): { colors: ThemeColors; isDark: boolean } {
  const systemScheme = useColorScheme();
  const isDark = systemScheme === 'dark';
  return { colors: isDark ? darkColors : lightColors, isDark };
}

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  hero: 48,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;
