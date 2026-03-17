import { useEffect, useState } from 'react';
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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useOperatorStore } from '@/lib/operator-store';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

interface OrgInfo {
  name: string;
  officeCount: number;
  staffCount: number;
  deskCount: number;
}

interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  check_in_mode: string;
  ticket_prefix: string;
  auto_no_show_minutes: number | null;
  max_queue_size: number | null;
  default_screen_layout: string;
  announcement_sound: boolean;
  supported_languages: string[];
  default_language: string;
}

const CHECK_IN_MODES = ['self_service', 'manual', 'hybrid'];
const SCREEN_LAYOUTS = ['list', 'grid', 'department_split'];
const LANGUAGES = ['en', 'fr', 'ar', 'es'];
const LANGUAGE_LABELS: Record<string, string> = { en: 'English', fr: 'French', ar: 'Arabic', es: 'Spanish' };

export default function MoreScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { clearSession } = useOperatorStore();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOrg();
  }, [user]);

  const loadOrg = async () => {
    if (!user) return;
    const { data: staff } = await supabase
      .from('staff')
      .select('organization_id, organizations:organization_id(name)')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!staff) return;
    const orgId = staff.organization_id;
    const orgName = (staff as any).organizations?.name ?? '';

    const [offices, staffCount, desks, orgData] = await Promise.all([
      supabase.from('offices').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      supabase.from('staff').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
      supabase.from('desks').select('id', { count: 'exact', head: true }).in('office_id',
        (await supabase.from('offices').select('id').eq('organization_id', orgId)).data?.map(o => o.id) ?? []
      ),
      supabase.from('organizations').select('*').eq('id', orgId).single(),
    ]);

    setOrg({
      name: orgName,
      officeCount: offices.count ?? 0,
      staffCount: staffCount.count ?? 0,
      deskCount: desks.count ?? 0,
    });

    if (orgData.data) {
      const d = orgData.data as any;
      setSettings({
        id: d.id,
        name: d.name ?? '',
        slug: d.slug ?? '',
        check_in_mode: d.check_in_mode ?? 'self_service',
        ticket_prefix: d.ticket_prefix ?? '',
        auto_no_show_minutes: d.auto_no_show_minutes ?? null,
        max_queue_size: d.max_queue_size ?? null,
        default_screen_layout: d.default_screen_layout ?? 'list',
        announcement_sound: d.announcement_sound ?? true,
        supported_languages: d.supported_languages ?? ['en'],
        default_language: d.default_language ?? 'en',
      });
    }
  };

  const updateSetting = async (field: string, value: unknown) => {
    if (!settings) return;
    setSaving(true);
    const updated = { ...settings, [field]: value } as OrgSettings;
    setSettings(updated);
    await supabase.from('organizations').update({ [field]: value }).eq('id', settings.id);
    setSaving(false);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          clearSession();
          await signOut();
          router.replace('/(tabs)');
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.infoRow}>
          <Ionicons name="person-circle-outline" size={22} color={colors.text} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{user?.email ?? '—'}</Text>
          </View>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="business-outline" size={22} color={colors.text} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Organization</Text>
            <Text style={styles.infoValue}>{org?.name ?? '—'}</Text>
          </View>
        </View>
      </View>

      {/* Organization Stats */}
      {org && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Organization</Text>
          <View style={styles.statsRow}>
            <StatItem icon="location" label="Offices" value={org.officeCount} />
            <StatItem icon="people" label="Staff" value={org.staffCount} />
            <StatItem icon="desktop" label="Desks" value={org.deskCount} />
          </View>
        </View>
      )}

      {/* Queue Settings */}
      {settings && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Queue Settings</Text>

          <SettingRow label="Check-in Mode" icon="log-in-outline">
            <View style={styles.chipRow}>
              {CHECK_IN_MODES.map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.chip, settings.check_in_mode === mode && styles.chipActive]}
                  onPress={() => updateSetting('check_in_mode', mode)}
                >
                  <Text style={[styles.chipText, settings.check_in_mode === mode && styles.chipTextActive]}>
                    {mode.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </SettingRow>

          <SettingRow label="Ticket Prefix" icon="pricetag-outline">
            <TextInput
              style={styles.input}
              value={settings.ticket_prefix}
              onChangeText={(v) => setSettings({ ...settings, ticket_prefix: v })}
              onBlur={() => updateSetting('ticket_prefix', settings.ticket_prefix)}
              placeholder="e.g. Q"
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>

          <SettingRow label="Auto No-Show (min)" icon="timer-outline">
            <TextInput
              style={styles.input}
              value={settings.auto_no_show_minutes?.toString() ?? ''}
              onChangeText={(v) => setSettings({ ...settings, auto_no_show_minutes: v ? parseInt(v) : null })}
              onBlur={() => updateSetting('auto_no_show_minutes', settings.auto_no_show_minutes)}
              keyboardType="number-pad"
              placeholder="Off"
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>

          <SettingRow label="Max Queue Size" icon="resize-outline">
            <TextInput
              style={styles.input}
              value={settings.max_queue_size?.toString() ?? ''}
              onChangeText={(v) => setSettings({ ...settings, max_queue_size: v ? parseInt(v) : null })}
              onBlur={() => updateSetting('max_queue_size', settings.max_queue_size)}
              keyboardType="number-pad"
              placeholder="Unlimited"
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>
        </View>
      )}

      {/* Display Settings */}
      {settings && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Display</Text>

          <SettingRow label="Screen Layout" icon="tv-outline">
            <View style={styles.chipRow}>
              {SCREEN_LAYOUTS.map((layout) => (
                <TouchableOpacity
                  key={layout}
                  style={[styles.chip, settings.default_screen_layout === layout && styles.chipActive]}
                  onPress={() => updateSetting('default_screen_layout', layout)}
                >
                  <Text style={[styles.chipText, settings.default_screen_layout === layout && styles.chipTextActive]}>
                    {layout.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </SettingRow>

          <SettingRow label="Announcement Sound" icon="volume-high-outline">
            <Switch
              value={settings.announcement_sound}
              onValueChange={(v) => updateSetting('announcement_sound', v)}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={settings.announcement_sound ? colors.primary : '#f4f3f4'}
            />
          </SettingRow>
        </View>
      )}

      {/* Language */}
      {settings && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Language</Text>

          <SettingRow label="Default Language" icon="globe-outline">
            <View style={styles.chipRow}>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[styles.chip, settings.default_language === lang && styles.chipActive]}
                  onPress={() => updateSetting('default_language', lang)}
                >
                  <Text style={[styles.chipText, settings.default_language === lang && styles.chipTextActive]}>
                    {LANGUAGE_LABELS[lang]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </SettingRow>
        </View>
      )}

      {/* Features */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Features</Text>

        <NavRow icon="calendar-outline" label="Bookings" subtitle="Manage appointments & check-ins" color={colors.waiting}
          onPress={() => router.push('/admin/bookings')} />

        <NavRow icon="qr-code-outline" label="Virtual Codes" subtitle="QR codes for queue joining" color={colors.success}
          onPress={() => router.push('/admin/virtual-codes')} />
      </View>

      {/* Navigation */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Switch View</Text>

        <NavRow icon="desktop-outline" label="Desk Operator" subtitle="Serve customers from your desk" color={colors.primary}
          onPress={() => router.push('/(auth)/role-select')} />

        <NavRow icon="ticket-outline" label="Customer View" subtitle="Track queue as a customer" color={colors.serving}
          onPress={() => router.push('/(tabs)')} />
      </View>

      {/* Sign Out */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.signOutRow} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={22} color={colors.error} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>QueueFlow v1.0.0</Text>
    </ScrollView>
  );
}

function StatItem({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon as any} size={20} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function NavRow({ icon, label, subtitle, color, onPress }: { icon: string; label: string; subtitle: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navRow} onPress={onPress}>
      <View style={[styles.navIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.navLabel}>{label}</Text>
        <Text style={styles.navSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function SettingRow({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabel}>
        <Ionicons name={icon as any} size={18} color={colors.textSecondary} />
        <Text style={styles.settingLabelText}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  section: { backgroundColor: colors.surface, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.lg },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  infoLabel: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center', gap: 4 },
  statValue: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  navIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  navLabel: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  navSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  signOutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  signOutText: { fontSize: fontSize.md, fontWeight: '600', color: colors.error },
  version: { textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.md },
  settingRow: { gap: spacing.sm },
  settingLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  settingLabelText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.surfaceSecondary },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.md, color: colors.text, fontWeight: '600' },
});
