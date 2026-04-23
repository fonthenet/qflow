/**
 * Profile screen — customer preferences, auth state, and settings.
 *
 * Sections:
 *   - Account: sign in / sign out
 *   - Language picker: EN / FR / AR
 *   - Appearance: light / dark / system
 *   - Biometric auth toggle (stub — wired to useBiometricAuth)
 *   - Notifications (stub — wired to usePushNotifications rationale flow)
 *   - Legal: privacy policy, terms of service
 *   - App version
 *
 * TODO(mobile-sprint-2): Implement sign-in via Supabase magic link.
 *   On sign-in, load and display the user's booking history from Supabase.
 *
 * TODO(mobile-sprint-2): Persist theme preference (light/dark/system) to
 *   AsyncStorage and lift into a zustand store so all screens react.
 *
 * TODO(mobile-sprint-2): Wire the biometric toggle:
 *   - Save preference to expo-secure-store (not AsyncStorage — biometric pref
 *     is security-sensitive and should be encrypted at rest)
 *   - Gate queue/appointments screens if enabled
 *
 * TODO(mobile-sprint-3): Notification rationale screen before requesting
 *   OS permission. Never call requestPermission() without showing rationale.
 */

import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import Constants from 'expo-constants';

import { useTheme, spacing, fontSize, borderRadius } from '@/lib/theme';
import { LANGUAGES, setLanguage, type LangCode } from '@/lib/i18n';
import { useBiometricAuth } from '@/hooks/useBiometricAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { PRIVACY_URL, TERMS_URL } from '@/lib/config';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { i18n } = useTranslation();

  const { isAvailable: biometricAvailable, isEnrolled: biometricEnrolled } =
    useBiometricAuth();
  const { permissionStatus: pushStatus, requestPermission: requestPush } =
    usePushNotifications();

  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ?? '1.0.0';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      {/* Account section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          Account
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* TODO(mobile-sprint-2): check Supabase session here */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              // TODO: navigate to sign-in screen or trigger magic link
            }}
            accessibilityRole="button"
            accessibilityLabel={t('profile.signIn')}
          >
            <Text style={[styles.rowLabel, { color: colors.text }]}>
              {t('profile.signIn')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Language section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {t('profile.language')}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {LANGUAGES.map((lang, idx) => (
            <TouchableOpacity
              key={lang.code}
              style={[
                styles.row,
                idx < LANGUAGES.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
              onPress={() => setLanguage(lang.code as LangCode)}
              accessibilityRole="radio"
              accessibilityState={{ checked: i18n.language === lang.code }}
              accessibilityLabel={lang.nativeLabel}
            >
              <Text style={[styles.rowLabel, { color: colors.text }]}>
                {lang.nativeLabel}
              </Text>
              {i18n.language === lang.code && (
                <Text style={[styles.checkmark, { color: colors.primary }]}>
                  ✓
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Biometric section */}
      {biometricAvailable && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {t('profile.biometric')}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>
                {t('profile.biometricEnable')}
              </Text>
              <Switch
                value={false /* TODO: read from secure-store */}
                onValueChange={() => {
                  // TODO(mobile-sprint-2): toggle biometric preference in
                  //   expo-secure-store and update zustand state
                }}
                thumbColor={colors.primary}
                accessibilityLabel={t('profile.biometricEnable')}
                disabled={!biometricEnrolled}
              />
            </View>
          </View>
          {!biometricEnrolled && (
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t('biometric.notEnrolled')}
            </Text>
          )}
        </View>
      )}

      {/* Notifications section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {t('profile.notifications')}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>
              {t('profile.notifications')}
            </Text>
            <Switch
              value={pushStatus === 'granted'}
              onValueChange={async (enabled) => {
                if (enabled) {
                  // TODO(mobile-sprint-3): show rationale screen first, then:
                  await requestPush();
                }
              }}
              thumbColor={colors.primary}
              disabled={pushStatus === 'denied'}
              accessibilityLabel={t('profile.notifications')}
            />
          </View>
        </View>
        {pushStatus === 'denied' && (
          <TouchableOpacity
            style={styles.hintLink}
            onPress={() => Linking.openSettings()}
            accessibilityRole="button"
          >
            <Text style={[styles.hintLinkText, { color: colors.primary }]}>
              Enable in Settings
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Legal section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          Legal
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
            onPress={() => Linking.openURL(PRIVACY_URL)}
            accessibilityRole="link"
            accessibilityLabel={t('profile.privacy')}
          >
            <Text style={[styles.rowLabel, { color: colors.text }]}>
              {t('profile.privacy')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.row}
            onPress={() => Linking.openURL(TERMS_URL)}
            accessibilityRole="link"
            accessibilityLabel={t('profile.terms')}
          >
            <Text style={[styles.rowLabel, { color: colors.text }]}>
              {t('profile.terms')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Version */}
      <Text style={[styles.version, { color: colors.textMuted }]}>
        {t('profile.version', { ver: appVersion })}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  section: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginLeft: spacing.sm,
    marginBottom: spacing.xs,
  },
  card: {
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44, // accessibility tap target
  },
  rowLabel: {
    fontSize: fontSize.md,
    flex: 1,
  },
  checkmark: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  hint: {
    fontSize: fontSize.xs,
    marginLeft: spacing.sm,
    marginTop: spacing.xs,
    lineHeight: 16,
  },
  hintLink: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  hintLinkText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  version: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
