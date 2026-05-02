import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppStore, type ThemeMode } from '@/lib/store';
import { useAuth } from '@/lib/auth-context';
import { useRiderAuth } from '@/lib/rider-auth';
import { useOperatorStore } from '@/lib/operator-store';
import { requestPermissions } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { setLanguage, LANGUAGES } from '@/lib/i18n';
import type { LangCode } from '@/lib/i18n';
import { useTheme, type ThemeColors, borderRadius, fontSize, spacing } from '@/lib/theme';
import { SUPPORT_EMAIL, PRIVACY_URL, TERMS_URL } from '@/lib/config';

const THEME_OPTIONS: { value: ThemeMode; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', labelKey: 'profile.light', icon: 'sunny-outline' },
  { value: 'dark', labelKey: 'profile.dark', icon: 'moon-outline' },
  { value: 'system', labelKey: 'profile.system', icon: 'phone-portrait-outline' },
];

export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user, isStaff, staffRole, signOut } = useAuth();
  const { rider: riderSession, signOut: riderSignOut } = useRiderAuth();
  const driverSignedIn = Boolean(riderSession);
  const { clearSession } = useOperatorStore();
  const { customerName, customerPhone, setCustomerInfo, themeMode, setThemeMode } = useAppStore();
  const { colors, isDark } = useTheme();
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(!customerName && !customerPhone);

  // Read actual OS permission status on mount and when app comes back to foreground
  useEffect(() => {
    const checkPermissions = async () => {
      const { status } = await Notifications.getPermissionsAsync();
      setNotificationsEnabled(status === 'granted');
    };
    checkPermissions();

    const sub = Notifications.addNotificationReceivedListener(() => {});
    return () => sub.remove();
  }, []);

  const handleSave = () => {
    setCustomerInfo(name, phone);
    setSaved(true);
    setEditing(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggleNotifications = async (value: boolean) => {
    if (value) {
      const { status: existing } = await Notifications.getPermissionsAsync();

      if (existing === 'denied') {
        // Already denied — iOS/Android won't show dialog again, send to Settings
        Alert.alert(
          t('profile.enableNotifications'),
          t('profile.notificationsBlocked'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('profile.openSettings'),
              onPress: () => {
                if (Platform.OS === 'ios') {
                  Linking.openURL('app-settings:');
                } else {
                  Linking.openSettings();
                }
              },
            },
          ]
        );
        setNotificationsEnabled(false);
        return;
      }

      const granted = await requestPermissions();
      setNotificationsEnabled(granted);
      if (!granted) {
        Alert.alert(
          t('profile.notificationsDisabled'),
          t('profile.notificationsDisabledMsg'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('profile.openSettings'),
              onPress: () => {
                if (Platform.OS === 'ios') {
                  Linking.openURL('app-settings:');
                } else {
                  Linking.openSettings();
                }
              },
            },
          ]
        );
      }
    } else {
      // Can't programmatically revoke — direct to settings
      Alert.alert(
        t('profile.turnOffNotifications'),
        t('profile.turnOffNotificationsMsg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('profile.openSettings'),
            onPress: () => {
              if (Platform.OS === 'ios') {
                Linking.openURL('app-settings:');
              } else {
                Linking.openSettings();
              }
            },
          },
        ]
      );
    }
  };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: 'qflo://reset-password',
    });
    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      Alert.alert(t('auth.checkEmail'), t('auth.checkEmailMsg', { email: user.email }));
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('profile.deleteAccount'),
      t('profile.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.deleteMyAccount'),
          style: 'destructive',
          onPress: () => {
            Linking.openURL(
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Account Deletion Request')}&body=${encodeURIComponent(`Please delete my account.\nEmail: ${user?.email ?? 'N/A'}`)}`
            );
          },
        },
      ]
    );
  };

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const ds = dynamicStyles(colors, isDark);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={ds.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

      {/* ── Staff Section (top) ─────────────────────────────── */}
      {user && isStaff ? (
        <View style={ds.section}>
          <View style={styles.staffHeader}>
            <View style={[styles.staffAvatar, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="person-circle" size={36} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ds.sectionTitle}>{user.email}</Text>
              <Text style={ds.rowSubtitle}>
                {staffRole === 'admin' ? t('profile.administrator') : staffRole === 'manager' ? t('profile.manager') : t('profile.operator')}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.proButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (staffRole === 'admin' || staffRole === 'manager' || staffRole === 'branch_admin') {
                router.replace('/(admin)');
              } else {
                router.replace('/(auth)/role-select');
              }
            }}
          >
            <Ionicons name="arrow-forward-circle" size={20} color="#fff" />
            <Text style={styles.proButtonText}>
              {staffRole === 'admin' || staffRole === 'manager' || staffRole === 'branch_admin'
                ? t('profile.openAdmin')
                : t('profile.openDesk')}
            </Text>
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.row} onPress={handleChangePassword}>
            <View style={styles.rowLeft}>
              <Ionicons name="key-outline" size={20} color={colors.text} />
              <View>
                <Text style={ds.rowTitle}>{t('profile.changePassword')}</Text>
                <Text style={ds.rowSubtitle}>{t('profile.changePasswordSub')}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={handleDeleteAccount}>
            <View style={styles.rowLeft}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
              <View>
                <Text style={[ds.rowTitle, { color: colors.error }]}>{t('profile.deleteAccount')}</Text>
                <Text style={ds.rowSubtitle}>{t('profile.deleteAccountSub')}</Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              Alert.alert(t('auth.signOut'), t('auth.signOutStaffConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('auth.signOut'),
                  style: 'destructive',
                  onPress: async () => {
                    clearSession();
                    await signOut();
                  },
                },
              ]);
            }}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="log-out-outline" size={20} color={colors.error} />
              <View>
                <Text style={[ds.rowTitle, { color: colors.error }]}>{t('auth.signOut')}</Text>
                <Text style={ds.rowSubtitle}>{t('profile.returnToCustomer')}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      ) : driverSignedIn ? (
        // Signed in as driver — show an active-mode banner, hide the
        // Staff portal and customer-edit entries entirely. A driver
        // session is its own identity; mixing in customer/staff entry
        // points would imply they apply to the same account.
        <TouchableOpacity
          style={[ds.section, styles.staffLoginBanner, {
            borderWidth: 1, borderColor: '#1d4ed8',
            backgroundColor: isDark ? '#1d4ed820' : '#1d4ed810',
          }]}
          onPress={() => router.push('/rider' as any)}
          activeOpacity={0.8}
        >
          <View style={[styles.staffLoginIcon, { backgroundColor: '#1d4ed825' }]}>
            <MaterialCommunityIcons name="moped" size={28} color="#1d4ed8" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[ds.rowTitle, { fontSize: fontSize.md }]}>
                {riderSession!.name}
              </Text>
              <View style={{
                paddingHorizontal: 8, paddingVertical: 2,
                borderRadius: 999,
                backgroundColor: '#16a34a',
              }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 }}>
                  {t('auth.driverActive', { defaultValue: 'DRIVER' })}
                </Text>
              </View>
            </View>
            <Text style={ds.rowSubtitle}>
              {t('auth.driverSignedInSub', {
                defaultValue: 'Signed in as driver — tap to open',
              })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#1d4ed8" />
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity
            style={[ds.section, styles.staffLoginBanner]}
            onPress={() => router.push('/(auth)/login')}
            activeOpacity={0.8}
          >
            <View style={[styles.staffLoginIcon, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons name="briefcase" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ds.rowTitle, { fontSize: fontSize.md }]}>{t('auth.staffPortal')}</Text>
              <Text style={ds.rowSubtitle}>{t('settings.adminDashboardSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.primary} />
          </TouchableOpacity>

          {/* Driver portal — phone-OTP login (no Supabase auth). */}
          <TouchableOpacity
            style={[ds.section, styles.staffLoginBanner]}
            onPress={() => router.push('/rider' as any)}
            activeOpacity={0.8}
          >
            <View style={[styles.staffLoginIcon, { backgroundColor: '#1d4ed815' }]}>
              <MaterialCommunityIcons name="moped" size={28} color="#1d4ed8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ds.rowTitle, { fontSize: fontSize.md }]}>{t('auth.driverPortal', { defaultValue: 'Driver portal' })}</Text>
              <Text style={ds.rowSubtitle}>{t('auth.driverPortalSub', { defaultValue: 'Sign in with your WhatsApp number to manage deliveries' })}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#1d4ed8" />
          </TouchableOpacity>
        </>
      )}

      {/* ── Personal Information ─────────────────────────────── */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>{t('customer.myInfo')}</Text>

        {editing ? (
          <>
            <Text style={ds.sectionSubtitle}>{t('customer.editInfo')}</Text>

            <View style={styles.inputGroup}>
              <Text style={ds.label}>{t('customer.fullName')}</Text>
              <TextInput
                style={ds.input}
                value={name}
                onChangeText={setName}
                placeholder={t('customer.yourName')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={ds.label}>{t('customer.phoneNumber')}</Text>
              <TextInput
                style={ds.input}
                value={phone}
                onChangeText={setPhone}
                placeholder={t('customer.yourPhone')}
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
              onPress={handleSave}
            >
              <Text style={styles.saveButtonText}>{t('common.save')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {saved && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={{ fontSize: 13, color: colors.success, fontWeight: '600' }}>{t('common.saved')}</Text>
              </View>
            )}

            {name ? (
              <View style={styles.savedRow}>
                <Text style={ds.label}>{t('customer.fullName')}</Text>
                <Text style={[ds.savedValue]}>{name}</Text>
              </View>
            ) : null}

            {phone ? (
              <View style={styles.savedRow}>
                <Text style={ds.label}>{t('customer.phoneNumber')}</Text>
                <Text style={[ds.savedValue]}>{phone}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary }]}
              onPress={() => { setEditing(true); setSaved(false); }}
            >
              <Ionicons name="create-outline" size={16} color={colors.primary} />
              <Text style={[styles.saveButtonText, { color: colors.primary }]}>{t('common.edit')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Notifications ────────────────────────────────────── */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>{t('profile.notifications')}</Text>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="notifications" size={20} color={notificationsEnabled ? colors.primary : colors.textMuted} />
            <View>
              <Text style={ds.rowTitle}>{t('profile.pushNotifications')}</Text>
              <Text style={ds.rowSubtitle}>
                {notificationsEnabled ? t('profile.notificationsOnSub') : t('profile.notificationsOffSub')}
              </Text>
            </View>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleToggleNotifications}
            trackColor={{ false: '#e2e8f0', true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* ── Appearance ───────────────────────────────────────── */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>{t('profile.appearance')}</Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((opt) => {
            const active = themeMode === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[ds.themeOption, active && ds.themeOptionActive]}
                onPress={() => setThemeMode(opt.value)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={opt.icon}
                  size={20}
                  color={active ? colors.primary : colors.textMuted}
                />
                <Text style={[ds.themeLabel, active && ds.themeLabelActive]}>
                  {t(opt.labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Language ─────────────────────────────────────────── */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>{t('adminMore.language')}</Text>
        <View style={styles.themeRow}>
          {LANGUAGES.map((lang) => {
            const active = i18n.language === lang.code;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[ds.themeOption, active && ds.themeOptionActive]}
                onPress={() => setLanguage(lang.code as LangCode)}
                activeOpacity={0.7}
              >
                <Text style={[ds.themeLabel, active && ds.themeLabelActive]}>
                  {lang.nativeLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── About, Support & Legal (combined) ────────────────── */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>{t('profile.aboutSupport')}</Text>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
            <View>
              <Text style={ds.rowTitle}>{t('profile.version')}</Text>
              <Text style={ds.rowSubtitle}>Qflo {appVersion}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
          <View style={styles.rowLeft}>
            <Ionicons name="mail-outline" size={20} color={colors.text} />
            <View>
              <Text style={ds.rowTitle}>{t('profile.contactSupport')}</Text>
              <Text style={ds.rowSubtitle}>{SUPPORT_EMAIL}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(PRIVACY_URL)}>
          <View style={styles.rowLeft}>
            <Ionicons name="document-text-outline" size={20} color={colors.text} />
            <Text style={ds.rowTitle}>{t('profile.privacyPolicy')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(TERMS_URL)}>
          <View style={styles.rowLeft}>
            <Ionicons name="document-outline" size={20} color={colors.text} />
            <Text style={ds.rowTitle}>{t('profile.termsOfService')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function dynamicStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    section: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.xl,
      padding: spacing.lg,
      gap: spacing.md,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDark ? 0.2 : 0.04,
      shadowRadius: 8,
      elevation: 2,
    },
    sectionTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: colors.text,
    },
    sectionSubtitle: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginTop: -8,
    },
    label: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    input: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: fontSize.md,
      color: colors.text,
      borderWidth: isDark ? 1 : 0,
      borderColor: colors.border,
    },
    savedValue: {
      fontSize: fontSize.md,
      fontWeight: '500',
      color: colors.text,
    },
    rowTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: colors.text,
    },
    rowSubtitle: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
    },
    themeOption: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
      paddingVertical: 12,
      borderRadius: borderRadius.lg,
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    themeOptionActive: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : 'rgba(29,78,216,0.06)',
    },
    themeLabel: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.textMuted,
    },
    themeLabelActive: {
      color: colors.primary,
    },
  });
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  themeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  savedRow: {
    gap: 2,
    paddingVertical: spacing.xs,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    marginTop: spacing.xs,
  },
  saveButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#fff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  proButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  proButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: '#fff',
  },
  staffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  staffAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  staffLoginBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  staffLoginIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    marginVertical: spacing.xs,
  },
});
