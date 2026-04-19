import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { Alert, I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';

const LANG_KEY = 'qflow_language';

export const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', rtl: false },
  { code: 'fr', label: 'French', nativeLabel: 'Français', rtl: false },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

function getInitialLanguage(): LangCode {
  // If I18nManager.isRTL is true (persisted from previous session's forceRTL),
  // the user had Arabic selected — start with 'ar' so we don't override isRTL
  // with forceRTL(false) before StyleSheets are created.
  if (I18nManager.isRTL) return 'ar';

  const locales = getLocales();
  const deviceLang = locales?.[0]?.languageCode ?? 'en';
  if (['fr'].includes(deviceLang)) return 'fr';
  if (['ar'].includes(deviceLang)) return 'ar';
  return 'en';
}

/** Apply RTL/LTR layout direction to match the language */
function applyRTL(lang: string, promptRestart = false) {
  const shouldBeRTL = lang === 'ar';
  const needsChange = I18nManager.isRTL !== shouldBeRTL;
  I18nManager.allowRTL(shouldBeRTL);
  I18nManager.forceRTL(shouldBeRTL);

  // On web, set the HTML dir attribute directly — I18nManager has no effect
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = shouldBeRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }

  // RTL changes require a full app restart on native
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

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr }, ar: { translation: ar } },
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

// Apply RTL for initial language
applyRTL(i18n.language);

// Restore saved language preference
AsyncStorage.getItem(LANG_KEY).then((saved) => {
  if (saved && ['en', 'fr', 'ar'].includes(saved)) {
    i18n.changeLanguage(saved);
    applyRTL(saved);
  }
});

export async function setLanguage(code: LangCode) {
  await AsyncStorage.setItem(LANG_KEY, code);
  await i18n.changeLanguage(code);
  applyRTL(code, true);
}

export function isRTL(): boolean {
  return i18n.language === 'ar';
}

/** Ionicons back-arrow name that mirrors in RTL. Use this wherever a screen
 *  renders a "← back" affordance so Arabic users see the arrow pointing the
 *  correct (visual) way. Pass the style you want: 'arrow' → arrow-back /
 *  arrow-forward; 'chevron' → chevron-back / chevron-forward. */
export function backIconName(style: 'arrow' | 'chevron' = 'chevron'):
  | 'chevron-back' | 'chevron-forward' | 'arrow-back' | 'arrow-forward' {
  const rtl = isRTL();
  if (style === 'arrow') return rtl ? 'arrow-forward' : 'arrow-back';
  return rtl ? 'chevron-forward' : 'chevron-back';
}

export default i18n;
