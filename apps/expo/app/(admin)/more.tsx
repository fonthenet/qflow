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
  // JSON settings
  booking_mode: string;
  booking_horizon_days: number;
  slot_duration_minutes: number;
  slots_per_interval: number;
}

const CHECK_IN_MODES = ['self_service', 'manual', 'hybrid'];
const SCREEN_LAYOUTS = ['list', 'grid', 'department_split'];
const LANGUAGES = ['en', 'fr', 'ar', 'es'];
const LANGUAGE_LABELS: Record<string, string> = { en: 'English', fr: 'French', ar: 'Arabic', es: 'Spanish' };

export default function MoreScreen() {
  const router = useRouter();
  const { user, signOut, staffRole } = useAuth();
  const { clearSession } = useOperatorStore();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  useEffect(() => {
    loadOrg();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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

    const { data: officeRows } = await supabase.from('offices').select('id').eq('organization_id', orgId);
    const officeIds = officeRows?.map(o => o.id) ?? [];

    const [offices, staffCount, desks, orgData] = await Promise.all([
      supabase.from('offices').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      supabase.from('staff').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
      officeIds.length > 0
        ? supabase.from('desks').select('id', { count: 'exact', head: true }).in('office_id', officeIds)
        : Promise.resolve({ count: 0 }),
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
      const jsonSettings = (d.settings as Record<string, any>) ?? {};
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
        booking_mode: jsonSettings.booking_mode ?? 'simple',
        booking_horizon_days: jsonSettings.booking_horizon_days ?? 7,
        slot_duration_minutes: jsonSettings.slot_duration_minutes ?? 30,
        slots_per_interval: jsonSettings.slots_per_interval ?? 1,
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

  const updateSettingsJson = async (key: string, value: unknown) => {
    if (!settings) return;
    setSaving(true);
    const { data: orgRow } = await supabase.from('organizations').select('settings').eq('id', settings.id).single();
    const current = (orgRow?.settings as Record<string, any>) ?? {};
    const merged = { ...current, [key]: value };
    await supabase.from('organizations').update({ settings: merged }).eq('id', settings.id);
    setSettings({ ...settings, [key]: value } as any);
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

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const isOperator = staffRole === 'operator' || staffRole === 'branch_admin' || staffRole === 'manager' || staffRole === 'admin';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Quick Actions ── */}
      <View style={styles.quickActions}>
        {isOperator && (
          <TouchableOpacity
            style={styles.quickActionPrimary}
            onPress={() => router.push('/(auth)/role-select')}
          >
            <View style={styles.quickActionIconWrap}>
              <Ionicons name="desktop-outline" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickActionTitle}>Start Serving</Text>
              <Text style={styles.quickActionSub}>Select desk & serve customers</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        )}

        <View style={styles.quickActionRow}>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(tabs)')}
          >
            <Ionicons name="people-outline" size={22} color={colors.primary} />
            <Text style={styles.quickActionCardLabel}>Customer View</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/admin/bookings')}
          >
            <Ionicons name="calendar-outline" size={22} color={colors.waiting} />
            <Text style={styles.quickActionCardLabel}>Bookings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/admin/virtual-codes')}
          >
            <Ionicons name="qr-code-outline" size={22} color={colors.success} />
            <Text style={styles.quickActionCardLabel}>QR Codes</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Account & Org ── */}
      <View style={styles.section}>
        <View style={styles.accountHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user?.email ?? '?')[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.accountEmail}>{user?.email ?? '—'}</Text>
            <Text style={styles.accountOrg}>{org?.name ?? '—'}</Text>
          </View>
          {staffRole && (
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{staffRole.replace(/_/g, ' ')}</Text>
            </View>
          )}
        </View>

        {org && (
          <View style={styles.statsRow}>
            <StatItem icon="location" label="Offices" value={org.officeCount} />
            <StatItem icon="people" label="Staff" value={org.staffCount} />
            <StatItem icon="desktop" label="Desks" value={org.deskCount} />
          </View>
        )}
      </View>

      {/* ── Settings (collapsible) ── */}
      {settings && (
        <>
          {/* Queue Settings */}
          <CollapsibleSection
            title="Queue Settings"
            icon="options-outline"
            expanded={expandedSection === 'queue'}
            onToggle={() => toggleSection('queue')}
          >
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
          </CollapsibleSection>

          {/* Display & Language */}
          <CollapsibleSection
            title="Display & Language"
            icon="color-palette-outline"
            expanded={expandedSection === 'display'}
            onToggle={() => toggleSection('display')}
          >
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
                trackColor={{ false: '#e2e8f0', true: colors.primary }}
                thumbColor="#fff"
              />
            </SettingRow>

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
          </CollapsibleSection>

          {/* Booking & Scheduling */}
          <CollapsibleSection
            title="Booking & Scheduling"
            icon="calendar-outline"
            expanded={expandedSection === 'booking'}
            onToggle={() => toggleSection('booking')}
          >
            <SettingRow label="Booking Mode" icon="calendar-outline">
              <View style={styles.chipRow}>
                {(['disabled', 'simple', 'advanced'] as const).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.chip, settings.booking_mode === mode && styles.chipActive]}
                    onPress={() => updateSettingsJson('booking_mode', mode)}
                  >
                    <Text style={[styles.chipText, settings.booking_mode === mode && styles.chipTextActive]}>
                      {mode}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </SettingRow>

            {settings.booking_mode === 'advanced' && (
              <>
                <SettingRow label="Booking Horizon (days)" icon="calendar-outline">
                  <TextInput
                    style={styles.input}
                    value={String(settings.booking_horizon_days)}
                    onChangeText={(v) => {
                      const n = parseInt(v) || 7;
                      setSettings({ ...settings, booking_horizon_days: n });
                    }}
                    onBlur={() => updateSettingsJson('booking_horizon_days', settings.booking_horizon_days)}
                    keyboardType="number-pad"
                    placeholder="7"
                    placeholderTextColor={colors.textMuted}
                  />
                </SettingRow>

                <SettingRow label="Slot Duration (min)" icon="time-outline">
                  <View style={styles.chipRow}>
                    {[15, 20, 30, 45, 60].map((d) => (
                      <TouchableOpacity
                        key={d}
                        style={[styles.chip, settings.slot_duration_minutes === d && styles.chipActive]}
                        onPress={() => updateSettingsJson('slot_duration_minutes', d)}
                      >
                        <Text style={[styles.chipText, settings.slot_duration_minutes === d && styles.chipTextActive]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </SettingRow>

                <SettingRow label="Bookings per Slot" icon="people-outline">
                  <TextInput
                    style={styles.input}
                    value={String(settings.slots_per_interval)}
                    onChangeText={(v) => {
                      const n = parseInt(v) || 1;
                      setSettings({ ...settings, slots_per_interval: n });
                    }}
                    onBlur={() => updateSettingsJson('slots_per_interval', settings.slots_per_interval)}
                    keyboardType="number-pad"
                    placeholder="1"
                    placeholderTextColor={colors.textMuted}
                  />
                </SettingRow>
              </>
            )}
          </CollapsibleSection>
        </>
      )}

      {/* ── Sign Out ── */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Qflo v1.0.0</Text>
    </ScrollView>
  );
}

/* ── Collapsible Section ── */

function CollapsibleSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.collapsibleHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.collapsibleLeft}>
          <Ionicons name={icon as any} size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {expanded && <View style={styles.collapsibleBody}>{children}</View>}
    </View>
  );
}

/* ── Sub-components ── */

function StatItem({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon as any} size={18} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SettingRow({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabel}>
        <Ionicons name={icon as any} size={16} color={colors.textSecondary} />
        <Text style={styles.settingLabelText}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

/* ── Styles ── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 100 },

  // Quick Actions
  quickActions: { gap: spacing.sm },
  quickActionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  quickActionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActionTitle: { fontSize: fontSize.lg, fontWeight: '700', color: '#fff' },
  quickActionSub: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  quickActionRow: { flexDirection: 'row', gap: spacing.sm },
  quickActionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickActionCardLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.text, textAlign: 'center' },

  // Account
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: '700', color: '#fff' },
  accountEmail: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  accountOrg: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  roleBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  roleBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary, textTransform: 'capitalize' },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted },

  // Collapsible
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapsibleLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  collapsibleBody: { marginTop: spacing.md, gap: spacing.md },

  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },

  // Settings
  settingRow: { gap: spacing.xs },
  settingLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  settingLabelText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
  },

  // Sign out
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.error + '30',
  },
  signOutText: { fontSize: fontSize.md, fontWeight: '600', color: colors.error },
  version: { textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
});
