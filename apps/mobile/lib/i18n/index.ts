/**
 * i18n initialisation for the Qflo customer mobile app.
 *
 * Locale resolution order (per qflo-i18n-specialist contract):
 *   1. User saved preference (AsyncStorage)
 *   2. Device locale (expo-localization)
 *   3. FR for Francophone defaults
 *   4. EN global fallback
 *
 * RTL: Arabic triggers I18nManager.forceRTL on native. A restart is required
 *   after toggling to/from Arabic on native platforms.
 *
 * String ownership: the canonical source is apps/expo/lib/locales/*.json.
 * apps/mobile imports the same files via tsconfig path aliases to avoid drift.
 *
 * TODO(i18n-specialist): When adding new customer-facing strings, add keys to
 *   all three locale files and update the shared source in apps/expo/lib/locales/.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { Alert, I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './en.json';
import fr from './fr.json';
import ar from './ar.json';

const LANG_STORAGE_KEY = 'qflo_customer_language';

export const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', rtl: false },
  { code: 'fr', label: 'French', nativeLabel: 'Français', rtl: false },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

function getDeviceLanguage(): LangCode {
  // If a previous session forced RTL the device is already in Arabic mode
  if (I18nManager.isRTL) return 'ar';

  const locales = getLocales();
  const deviceLang = locales?.[0]?.languageCode ?? 'en';

  if (deviceLang === 'fr') return 'fr';
  if (deviceLang === 'ar') return 'ar';
  return 'en';
}

function applyRTL(lang: string, promptRestart = false): void {
  const shouldBeRTL = lang === 'ar';
  const needsChange = I18nManager.isRTL !== shouldBeRTL;
  I18nManager.allowRTL(shouldBeRTL);
  I18nManager.forceRTL(shouldBeRTL);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = shouldBeRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }

  if (needsChange && promptRestart && Platform.OS !== 'web') {
    setTimeout(() => {
      Alert.alert(
        lang === 'ar' ? 'إعادة تشغيل مطلوبة' : 'Restart Required',
        lang === 'ar'
          ? 'يرجى إغلاق التطبيق وإعادة فتحه لتطبيق اتجاه اللغة الجديد.'
          : 'Please close and reopen the app to apply the new language direction.',
        [{ text: lang === 'ar' ? 'حسناً' : 'OK' }],
      );
    }, 300);
  }
}

// Initialise synchronously with device locale; async preference restores below
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: getDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

applyRTL(i18n.language);

// Restore saved preference asynchronously
AsyncStorage.getItem(LANG_STORAGE_KEY).then((saved) => {
  if (saved && ['en', 'fr', 'ar'].includes(saved)) {
    const lang = saved as LangCode;
    i18n.changeLanguage(lang);
    applyRTL(lang);
  }
});

export async function setLanguage(code: LangCode): Promise<void> {
  await AsyncStorage.setItem(LANG_STORAGE_KEY, code);
  await i18n.changeLanguage(code);
  applyRTL(code, true);
}

export function isRTL(): boolean {
  return i18n.language === 'ar';
}

/**
 * Returns the correct Ionicons back-arrow name for the current RTL state.
 * Ensures Arabic users see the arrow pointing the visual direction (→ not ←).
 */
export function backIconName(
  style: 'arrow' | 'chevron' = 'chevron',
): 'chevron-back' | 'chevron-forward' | 'arrow-back' | 'arrow-forward' {
  const rtl = isRTL();
  if (style === 'arrow') return rtl ? 'arrow-forward' : 'arrow-back';
  return rtl ? 'chevron-forward' : 'chevron-back';
}

export default i18n;
