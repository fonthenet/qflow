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

function normalizeDisplaySettings(settings: Record<string, unknown> | null | undefined) {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}

export function isDisplayScreenCustomized(settings: Record<string, unknown> | null | undefined) {
  return normalizeDisplaySettings(settings).customized === true;
}

export function mergeDisplayScreenRuntime(
  screen: RuntimeDisplayScreen,
  profile: DisplayProfile
) {
  const screenSettings = normalizeDisplaySettings(screen.settings);
  const customized = isDisplayScreenCustomized(screenSettings);

  const mergedSettings = customized
    ? {
        theme: profile.theme ?? 'light',
        show_clock: profile.showClock ?? true,
        show_next_up: profile.showNextUp ?? true,
        show_department_breakdown: profile.showDepartmentBreakdown ?? true,
        announcement_sound: profile.announcementSound ?? true,
        ...screenSettings,
      }
    : {
        theme: profile.theme ?? 'light',
        show_clock: profile.showClock ?? true,
        show_next_up: profile.showNextUp ?? true,
        show_department_breakdown: profile.showDepartmentBreakdown ?? true,
        announcement_sound: profile.announcementSound ?? true,
      };

  return {
    ...screen,
    layout: customized
      ? screen.layout ?? profile.defaultLayout ?? 'list'
      : profile.defaultLayout ?? 'list',
    settings: mergedSettings,
  };
}
