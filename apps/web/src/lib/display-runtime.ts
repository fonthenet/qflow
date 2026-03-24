type DisplayProfile = {
  defaultLayout?: string | null;
  theme?: string | null;
  showClock?: boolean | null;
  showNextUp?: boolean | null;
  showDepartmentBreakdown?: boolean | null;
  announcementSound?: boolean | null;
};

type RuntimeDisplayScreen = {
  layout?: string | null;
  settings?: Record<string, unknown> | null;
};

const DISPLAY_LIGHT_BG = '#f8fafc';
const DISPLAY_LIGHT_ACCENT = '#2563eb';
const LEGACY_DARK_BACKGROUNDS = new Set(['#0a1628', '#020617']);

function normalizeDisplaySettings(settings: Record<string, unknown> | null | undefined) {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}

export function isDisplayScreenCustomized(settings: Record<string, unknown> | null | undefined) {
  return normalizeDisplaySettings(settings).customized === true;
}

function resolveLightDisplayColors(
  settings: Record<string, unknown>,
  profile: DisplayProfile
) {
  const rawBg = typeof settings.bg_color === 'string' ? settings.bg_color.trim().toLowerCase() : '';
  const rawAccent =
    typeof settings.accent_color === 'string' ? settings.accent_color.trim() : '';

  return {
    bg_color:
      rawBg && !LEGACY_DARK_BACKGROUNDS.has(rawBg)
        ? (settings.bg_color as string)
        : DISPLAY_LIGHT_BG,
    accent_color: rawAccent || DISPLAY_LIGHT_ACCENT,
    theme: 'light' as const,
    show_clock: profile.showClock ?? true,
    show_next_up: profile.showNextUp ?? true,
    show_department_breakdown: profile.showDepartmentBreakdown ?? true,
    announcement_sound: profile.announcementSound ?? true,
  };
}

export function mergeDisplayScreenRuntime(
  screen: RuntimeDisplayScreen,
  profile: DisplayProfile
) {
  const screenSettings = normalizeDisplaySettings(screen.settings);
  const customized = isDisplayScreenCustomized(screenSettings);
  const lightRuntimeDefaults = resolveLightDisplayColors(screenSettings, profile);

  const mergedSettings = customized
    ? {
        ...screenSettings,
        ...lightRuntimeDefaults,
      }
    : {
        ...lightRuntimeDefaults,
      };

  return {
    ...screen,
    layout: customized
      ? screen.layout ?? profile.defaultLayout ?? 'list'
      : profile.defaultLayout ?? 'list',
    settings: mergedSettings,
  };
}
