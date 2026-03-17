import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppStore, type ThemeMode } from '@/lib/store';
import { useAuth } from '@/lib/auth-context';
import { useOperatorStore } from '@/lib/operator-store';
import { requestPermissions } from '@/lib/notifications';
import { useTheme, type ThemeColors, borderRadius, fontSize, spacing } from '@/lib/theme';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isStaff, staffRole, signOut } = useAuth();
  const { clearSession } = useOperatorStore();
  const { customerName, customerPhone, setCustomerInfo, themeMode, setThemeMode } = useAppStore();
  const { colors, isDark } = useTheme();
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setCustomerInfo(name, phone);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggleNotifications = async (value: boolean) => {
    if (value) {
      const granted = await requestPermissions();
      setNotificationsEnabled(granted);
      if (!granted) {
        Alert.alert(
          'Notifications Disabled',
          'Enable notifications in your device settings to receive queue updates.'
        );
      }
    } else {
      setNotificationsEnabled(false);
    }
  };

  const ds = dynamicStyles(colors, isDark);

  return (
    <ScrollView style={ds.container} contentContainerStyle={styles.content}>
      {/* Appearance */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>Appearance</Text>
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
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Personal Info */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>Personal Information</Text>
        <Text style={ds.sectionSubtitle}>
          Used to identify you when joining a queue
        </Text>

        <View style={styles.inputGroup}>
          <Text style={ds.label}>Name</Text>
          <TextInput
            style={ds.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={ds.label}>Phone</Text>
          <TextInput
            style={ds.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }, saved && { backgroundColor: colors.success }]}
          onPress={handleSave}
        >
          {saved ? (
            <>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.saveButtonText}>Saved</Text>
            </>
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Notifications */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>Notifications</Text>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            <View>
              <Text style={ds.rowTitle}>Push Notifications</Text>
              <Text style={ds.rowSubtitle}>Get notified when it's your turn</Text>
            </View>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleToggleNotifications}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            thumbColor={notificationsEnabled ? colors.primary : isDark ? '#475569' : '#f4f3f4'}
          />
        </View>
      </View>

      {/* Staff / Pro Section */}
      {user && isStaff ? (
        <View style={ds.section}>
          <Text style={ds.sectionTitle}>Staff Account</Text>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
              <View>
                <Text style={ds.rowTitle}>{user.email}</Text>
                <Text style={ds.rowSubtitle}>
                  {staffRole === 'admin' ? 'Administrator' : 'Operator'}
                </Text>
              </View>
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
                ? 'Go to Admin Dashboard'
                : 'Go to Desk Panel'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              Alert.alert('Sign Out', 'Sign out of your staff account?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Sign Out',
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
              <Ionicons name="log-out-outline" size={22} color={colors.error} />
              <View>
                <Text style={[ds.rowTitle, { color: colors.error }]}>Sign Out</Text>
                <Text style={ds.rowSubtitle}>Return to customer-only mode</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={ds.section}>
          <Text style={ds.sectionTitle}>Staff</Text>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/(auth)/login')}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="briefcase-outline" size={22} color={colors.primary} />
              <View>
                <Text style={ds.rowTitle}>Staff Login</Text>
                <Text style={ds.rowSubtitle}>Access the operator dashboard</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* About */}
      <View style={ds.section}>
        <Text style={ds.sectionTitle}>About</Text>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="information-circle-outline" size={22} color={colors.text} />
            <View>
              <Text style={ds.rowTitle}>Version</Text>
              <Text style={ds.rowSubtitle}>1.0.0</Text>
            </View>
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.text} />
            <View>
              <Text style={ds.rowTitle}>Privacy</Text>
              <Text style={ds.rowSubtitle}>Your data stays on your device</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
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
});
