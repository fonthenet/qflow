import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { useTranslation } from 'react-i18next';
import { setLanguage } from '@/lib/i18n';
import type { LangCode } from '@/lib/i18n';
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

const CHECK_IN_MODES = ['self_service', 'manual', 'hybrid'] as const;
const CHECK_IN_MODE_KEYS: Record<string, string> = {
  self_service: 'selfService',
  manual: 'manual',
  hybrid: 'hybrid',
};
const SCREEN_LAYOUTS = ['list', 'grid', 'department_split'] as const;
const SCREEN_LAYOUT_KEYS: Record<string, string> = {
  list: 'list',
  grid: 'grid',
  department_split: 'departmentSplit',
};
const LANGUAGES = ['en', 'fr', 'ar'];
const LANGUAGE_LABELS: Record<string, string> = { en: 'English', fr: 'Français', ar: 'العربية' };

const TIMEZONE_OPTIONS = [
  'Africa/Algiers', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Johannesburg',
  'Africa/Lagos', 'Africa/Nairobi', 'Africa/Tunis',
  'America/Anchorage', 'America/Argentina/Buenos_Aires', 'America/Bogota',
  'America/Chicago', 'America/Denver', 'America/Halifax', 'America/Lima',
  'America/Los_Angeles', 'America/Mexico_City', 'America/New_York',
  'America/Phoenix', 'America/Santiago', 'America/Sao_Paulo', 'America/Toronto',
  'Asia/Baghdad', 'Asia/Bangkok', 'Asia/Beirut', 'Asia/Colombo',
  'Asia/Dhaka', 'Asia/Dubai', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong',
  'Asia/Istanbul', 'Asia/Jakarta', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Riyadh', 'Asia/Seoul',
  'Asia/Shanghai', 'Asia/Singapore', 'Asia/Taipei', 'Asia/Tokyo',
  'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/London', 'Europe/Madrid',
  'Europe/Moscow', 'Europe/Paris', 'Europe/Rome', 'Europe/Zurich',
  'Pacific/Auckland', 'Pacific/Honolulu',
];

interface OfficeTimezone {
  id: string;
  name: string;
  timezone: string | null;
}

export default function MoreScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { user, signOut, staffRole } = useAuth();
  const { clearSession } = useOperatorStore();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [offices, setOffices] = useState<OfficeTimezone[]>([]);
  const [tzPickerVisible, setTzPickerVisible] = useState(false);
  const [tzPickerOfficeId, setTzPickerOfficeId] = useState<string | null>(null);
  const [tzSearch, setTzSearch] = useState('');

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

    // Load office timezones
    const { data: officeData } = await supabase
      .from('offices')
      .select('id, name, timezone')
      .eq('organization_id', orgId)
      .order('name');
    setOffices((officeData ?? []) as OfficeTimezone[]);
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

  const openTzPicker = (officeId: string) => {
    setTzPickerOfficeId(officeId);
    setTzSearch('');
    setTzPickerVisible(true);
  };

  const selectTimezone = async (tz: string) => {
    if (!tzPickerOfficeId) return;
    setTzPickerVisible(false);
    setSaving(true);
    const normalized = tz === 'Europe/Algiers' ? 'Africa/Algiers' : tz;
    await supabase.from('offices').update({ timezone: normalized }).eq('id', tzPickerOfficeId);
    setOffices((prev) =>
      prev.map((o) => (o.id === tzPickerOfficeId ? { ...o, timezone: normalized } : o)),
    );
    setSaving(false);
  };

  const handleSignOut = () => {
    Alert.alert(t('auth.signOut'), t('adminMore.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
              <Text style={styles.quickActionTitle}>{t('adminMore.startServing')}</Text>
              <Text style={styles.quickActionSub}>{t('adminMore.selectDeskServe')}</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        )}

        <View style={styles.quickActionRow}>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(admin)/manage')}
          >
            <Ionicons name="settings-outline" size={22} color={colors.primary} />
            <Text style={styles.quickActionCardLabel}>{t('adminMore.manage')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(tabs)')}
          >
            <Ionicons name="people-outline" size={22} color={colors.primary} />
            <Text style={styles.quickActionCardLabel}>{t('adminMore.customerView')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/admin/bookings')}
          >
            <Ionicons name="calendar-outline" size={22} color={colors.waiting} />
            <Text style={styles.quickActionCardLabel}>{t('adminMore.bookings')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/admin/virtual-codes')}
          >
            <Ionicons name="qr-code-outline" size={22} color={colors.success} />
            <Text style={styles.quickActionCardLabel}>{t('adminMore.qrCodes')}</Text>
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
            <StatItem icon="location" label={t('adminMore.offices')} value={org.officeCount} />
            <StatItem icon="people" label={t('adminMore.staffCount')} value={org.staffCount} />
            <StatItem icon="desktop" label={t('adminMore.desksCount')} value={org.deskCount} />
          </View>
        )}
      </View>

      {/* ── Settings (collapsible) ── */}
      {settings && (
        <>
          {/* Queue Settings */}
          <CollapsibleSection
            title={t('adminMore.queueSettings')}
            icon="options-outline"
            expanded={expandedSection === 'queue'}
            onToggle={() => toggleSection('queue')}
          >
            <SettingRow label={t('adminMore.checkInMode')} icon="log-in-outline">
              <View style={styles.chipRow}>
                {CHECK_IN_MODES.map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.chip, settings.check_in_mode === mode && styles.chipActive]}
                    onPress={() => updateSetting('check_in_mode', mode)}
                  >
                    <Text style={[styles.chipText, settings.check_in_mode === mode && styles.chipTextActive]}>
                      {t(`adminMore.${CHECK_IN_MODE_KEYS[mode]}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </SettingRow>

            <SettingRow label={t('adminMore.ticketPrefix')} icon="pricetag-outline">
              <TextInput
                style={styles.input}
                value={settings.ticket_prefix}
                onChangeText={(v) => setSettings({ ...settings, ticket_prefix: v })}
                onBlur={() => updateSetting('ticket_prefix', settings.ticket_prefix)}
                placeholder={t('adminMore.ticketPrefixPlaceholder')}
                placeholderTextColor={colors.textMuted}
              />
            </SettingRow>

            <SettingRow label={t('adminMore.autoNoShow')} icon="timer-outline">
              <TextInput
                style={styles.input}
                value={settings.auto_no_show_minutes?.toString() ?? ''}
                onChangeText={(v) => setSettings({ ...settings, auto_no_show_minutes: v ? parseInt(v) : null })}
                onBlur={() => updateSetting('auto_no_show_minutes', settings.auto_no_show_minutes)}
                keyboardType="number-pad"
                placeholder={t('adminMore.autoNoShowOff')}
                placeholderTextColor={colors.textMuted}
              />
            </SettingRow>

            <SettingRow label={t('adminMore.maxQueueSize')} icon="resize-outline">
              <TextInput
                style={styles.input}
                value={settings.max_queue_size?.toString() ?? ''}
                onChangeText={(v) => setSettings({ ...settings, max_queue_size: v ? parseInt(v) : null })}
                onBlur={() => updateSetting('max_queue_size', settings.max_queue_size)}
                keyboardType="number-pad"
                placeholder={t('adminMore.unlimited')}
                placeholderTextColor={colors.textMuted}
              />
            </SettingRow>
          </CollapsibleSection>

          {/* Display & Language */}
          <CollapsibleSection
            title={t('adminMore.displayLanguage')}
            icon="color-palette-outline"
            expanded={expandedSection === 'display'}
            onToggle={() => toggleSection('display')}
          >
            <SettingRow label={t('adminMore.screenLayout')} icon="tv-outline">
              <View style={styles.chipRow}>
                {SCREEN_LAYOUTS.map((layout) => (
                  <TouchableOpacity
                    key={layout}
                    style={[styles.chip, settings.default_screen_layout === layout && styles.chipActive]}
                    onPress={() => updateSetting('default_screen_layout', layout)}
                  >
                    <Text style={[styles.chipText, settings.default_screen_layout === layout && styles.chipTextActive]}>
                      {t(`adminMore.${SCREEN_LAYOUT_KEYS[layout]}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </SettingRow>

            <SettingRow label={t('adminMore.announcementSound')} icon="volume-high-outline">
              <Switch
                value={settings.announcement_sound}
                onValueChange={(v) => updateSetting('announcement_sound', v)}
                trackColor={{ false: '#e2e8f0', true: colors.primary }}
                thumbColor="#fff"
              />
            </SettingRow>

            <SettingRow label={t('adminMore.language')} icon="globe-outline">
              <View style={styles.chipRow}>
                {LANGUAGES.map((lang) => (
                  <TouchableOpacity
                    key={lang}
                    style={[styles.chip, i18n.language === lang && styles.chipActive]}
                    onPress={() => {
                      updateSetting('default_language', lang);
                      setLanguage(lang as LangCode);
                    }}
                  >
                    <Text style={[styles.chipText, i18n.language === lang && styles.chipTextActive]}>
                      {LANGUAGE_LABELS[lang]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </SettingRow>
          </CollapsibleSection>

          {/* Booking & Scheduling */}
          <CollapsibleSection
            title={t('adminMore.bookingScheduling')}
            icon="calendar-outline"
            expanded={expandedSection === 'booking'}
            onToggle={() => toggleSection('booking')}
          >
            <SettingRow label={t('adminMore.bookingMode')} icon="calendar-outline">
              <View style={styles.chipRow}>
                {(['disabled', 'simple', 'advanced'] as const).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.chip, settings.booking_mode === mode && styles.chipActive]}
                    onPress={() => updateSettingsJson('booking_mode', mode)}
                  >
                    <Text style={[styles.chipText, settings.booking_mode === mode && styles.chipTextActive]}>
                      {t(`adminMore.${mode}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </SettingRow>

            {settings.booking_mode === 'advanced' && (
              <>
                <SettingRow label={t('adminMore.bookingHorizon')} icon="calendar-outline">
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

                <SettingRow label={t('adminMore.slotDuration')} icon="time-outline">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => updateSettingsJson('slot_duration_minutes', Math.max(5, (settings.slot_duration_minutes || 30) - 5))}
                      disabled={(settings.slot_duration_minutes || 30) <= 5}
                      style={[styles.chip, { width: 36, opacity: (settings.slot_duration_minutes || 30) <= 5 ? 0.35 : 1 }]}
                    >
                      <Text style={[styles.chipText, { fontSize: 18, fontWeight: '700' }]}>−</Text>
                    </TouchableOpacity>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#e2e8f0', minWidth: 55, textAlign: 'center' }}>
                      {settings.slot_duration_minutes || 30} min
                    </Text>
                    <TouchableOpacity
                      onPress={() => updateSettingsJson('slot_duration_minutes', Math.min(120, (settings.slot_duration_minutes || 30) + 5))}
                      disabled={(settings.slot_duration_minutes || 30) >= 120}
                      style={[styles.chip, { width: 36, opacity: (settings.slot_duration_minutes || 30) >= 120 ? 0.35 : 1 }]}
                    >
                      <Text style={[styles.chipText, { fontSize: 18, fontWeight: '700' }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </SettingRow>

                <SettingRow label={t('adminMore.bookingsPerSlot')} icon="people-outline">
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

          {/* Timezone */}
          <CollapsibleSection
            title={t('adminMore.officeTimezones')}
            icon="time-outline"
            expanded={expandedSection === 'timezone'}
            onToggle={() => toggleSection('timezone')}
          >
            {offices.length === 0 ? (
              <Text style={{ color: colors.textMuted, fontSize: fontSize.sm, padding: spacing.sm }}>
                {t('adminMore.noOfficesFound')}
              </Text>
            ) : (
              offices.map((office) => (
                <View key={office.id} style={styles.tzRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tzOfficeName}>{office.name}</Text>
                    <Text style={styles.tzValue}>
                      {office.timezone ?? t('adminMore.notSet')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.tzChangeBtn}
                    onPress={() => openTzPicker(office.id)}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                    <Text style={styles.tzChangeBtnText}>{t('adminMore.change')}</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </CollapsibleSection>
        </>
      )}

      {/* ── Timezone Picker Modal ── */}
      <Modal visible={tzPickerVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.tzModal}>
          <View style={styles.tzModalHeader}>
            <Text style={styles.tzModalTitle}>{t('adminMore.selectTimezone')}</Text>
            <TouchableOpacity onPress={() => setTzPickerVisible(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.tzSearchWrap}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.tzSearchInput}
              placeholder={t('adminMore.searchTimezones')}
              placeholderTextColor={colors.textMuted}
              value={tzSearch}
              onChangeText={setTzSearch}
            />
          </View>
          <FlatList
            data={TIMEZONE_OPTIONS.filter((tz) =>
              tz.toLowerCase().includes(tzSearch.toLowerCase()),
            )}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const isSelected = offices.find((o) => o.id === tzPickerOfficeId)?.timezone === item;
              return (
                <TouchableOpacity
                  style={[styles.tzOption, isSelected && styles.tzOptionSelected]}
                  onPress={() => selectTimezone(item)}
                >
                  <Text style={[styles.tzOptionText, isSelected && styles.tzOptionTextSelected]}>
                    {item.replace(/_/g, ' ')}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.borderLight }} />}
          />
        </View>
      </Modal>

      {/* ── Sign Out ── */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.signOutText}>{t('auth.signOut')}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Qflo v1.0.0</Text>
    </ScrollView>
    </KeyboardAvoidingView>
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

  // Timezone
  tzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  tzOfficeName: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  tzValue: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  tzChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '12',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: borderRadius.md,
  },
  tzChangeBtnText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  tzModal: { flex: 1, backgroundColor: colors.background },
  tzModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tzModalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  tzSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: spacing.md,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tzSearchInput: { flex: 1, paddingVertical: 10, fontSize: fontSize.md, color: colors.text },
  tzOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  tzOptionSelected: { backgroundColor: colors.primary + '10' },
  tzOptionText: { fontSize: fontSize.md, color: colors.text },
  tzOptionTextSelected: { fontWeight: '700', color: colors.primary },
});
