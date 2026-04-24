/**
 * AdminSettings — a self-contained, fully-wired admin/org configuration panel.
 *
 * Loads org-level data directly from Supabase, writes back through the same
 * `organizations` table. Every control is real (no placeholders):
 *   - Column-level fields use `updateSetting` (writes `organizations.<col>`)
 *   - JSON-nested fields use `updateSettingsJson` (merges into `organizations.settings`)
 *
 * Intended to be rendered inside a tab body / scroll container — this component
 * owns its own ScrollView so it can be dropped anywhere.
 */
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '@/lib/i18n';
import type { LangCode } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';
import { isArabicCountry } from '@qflo/shared';

interface OrgSettings {
  id: string;
  // Columns on organizations
  name: string;
  slug: string;
  logo_url: string | null;
  // ── Keys inside organizations.settings JSON.
  // These are the CANONICAL keys Station/web read+write — mobile must use
  // the exact same names or it'll silently write to orphan keys nobody else
  // reads (that's how 24/7 drift happened before).
  check_in_mode: string;               // → settings.default_check_in_mode
  ticket_prefix: string;               // → settings.ticket_number_prefix
  auto_no_show_minutes: number | null; // → settings.auto_no_show_timeout
  max_queue_size: number | null;       // → settings.max_queue_size
  default_screen_layout: string;       // → settings.default_screen_layout
  announcement_sound: boolean;         // → settings.announcement_sound_enabled
  supported_languages: string[];       // → settings.supported_languages
  default_language: string;            // → settings.default_language
  /**
   * Org-level "always open" gate.
   * Station writes `organizations.settings.visit_intake_override_mode` and
   * mirrors it down to every office's `offices.settings`. Values:
   *   'business_hours' — follow per-day operating_hours
   *   'always_open'    — 24/7, ignore the day grid
   *   'always_closed'  — reject all intake
   * Mobile mirrors the same paths so Station + web + mobile agree.
   */
  always_open: boolean;
  booking_mode: string;
  booking_horizon_days: number;
  slot_duration_minutes: number;
  slots_per_interval: number;
  require_appointment_approval: boolean;
  require_ticket_approval: boolean;
  allow_cancellation: boolean;
  min_booking_lead_hours: number;
  daily_ticket_limit: number | null;
  // WhatsApp — business phone is hardcoded by QFlo; only the join keywords
  // are editable per-org (English + Arabic).
  whatsapp_enabled: boolean;
  whatsapp_code: string;     // English keyword (e.g. "JOIN")
  arabic_code: string;       // Arabic keyword (e.g. "انضم")
  country: string | null;    // ISO-3166 alpha-2; used to gate Arabic UI
  // Messenger — Facebook Page ID is hardcoded by QFlo; only the enable toggle
  // is exposed per-org.
  messenger_enabled: boolean;
  priority_alerts_sms_enabled: boolean;
  priority_alerts_sms_on_call: boolean;
  priority_alerts_sms_on_recall: boolean;
  priority_alerts_sms_on_buzz: boolean;
  priority_alerts_phone_label: string;
  email_otp_enabled: boolean;
  email_otp_required_for_booking: boolean;
}

interface OfficeTimezone {
  id: string;
  name: string;
  timezone: string | null;
  operating_hours: OperatingHours | null;
}

// ── Work schedule ──────────────────────────────────────────────────
// Mirrors the QFlo Station schema so hours edited on mobile load correctly
// on desktop and vice versa.
type WeekDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

interface DaySchedule {
  open: string;          // "HH:MM"
  close: string;         // "HH:MM"
  break_start?: string;  // optional midday break start
  break_end?: string;    // optional midday break end
}

type OperatingHours = Partial<Record<WeekDay, DaySchedule | null>>;

// "Closed" convention (matches Station): open == close == "00:00"
const CLOSED_HOURS: DaySchedule = { open: '00:00', close: '00:00' };
const DEFAULT_HOURS: DaySchedule = { open: '08:00', close: '17:00' };

const WEEK_DAYS: { key: WeekDay; labelKey: string }[] = [
  { key: 'monday',    labelKey: 'adminMore.dayMon' },
  { key: 'tuesday',   labelKey: 'adminMore.dayTue' },
  { key: 'wednesday', labelKey: 'adminMore.dayWed' },
  { key: 'thursday',  labelKey: 'adminMore.dayThu' },
  { key: 'friday',    labelKey: 'adminMore.dayFri' },
  { key: 'saturday',  labelKey: 'adminMore.daySat' },
  { key: 'sunday',    labelKey: 'adminMore.daySun' },
];

function isDayClosed(d: DaySchedule | null | undefined): boolean {
  if (!d) return true;
  return d.open === '00:00' && d.close === '00:00';
}

// Detect which (if any) preset currently matches a week's operating_hours.
// Returns null when the schedule is custom or partially set.
type PresetKey = 'weekdays' | 'mon_sat' | 'always' | null;
function matchingPreset(hours: OperatingHours): PresetKey {
  const day = (k: WeekDay) => hours[k] ?? null;
  const isOpenHours = (d: DaySchedule | null, open: string, close: string) =>
    !!d && !d.break_start && d.open === open && d.close === close;
  const isClosed = (d: DaySchedule | null) => isDayClosed(d);

  // Weekdays 9–5
  if (
    (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as WeekDay[])
      .every((k) => isOpenHours(day(k), '09:00', '17:00')) &&
    isClosed(day('saturday')) && isClosed(day('sunday'))
  ) return 'weekdays';

  // Mon–Sat 9–6
  if (
    (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as WeekDay[])
      .every((k) => isOpenHours(day(k), '09:00', '18:00')) &&
    isClosed(day('sunday'))
  ) return 'mon_sat';

  // 24/7 (00:00 → 23:59 for all seven days)
  if (WEEK_DAYS.every(({ key }) => isOpenHours(day(key), '00:00', '23:59'))) return 'always';

  return null;
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

export default function AdminSettings() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [, setSaving] = useState(false);
  // "Saved" indicator — pulsed after every successful persist.
  // `savedTick` increments each time so the effect re-runs even if the
  // previous banner is still visible.
  const [savedTick, setSavedTick] = useState(0);
  const [savedVisible, setSavedVisible] = useState(false);
  const pulseSaved = () => setSavedTick((n) => n + 1);
  useEffect(() => {
    if (savedTick === 0) return;
    setSavedVisible(true);
    const timer = setTimeout(() => setSavedVisible(false), 1400);
    return () => clearTimeout(timer);
  }, [savedTick]);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [offices, setOffices] = useState<OfficeTimezone[]>([]);
  const [tzPickerVisible, setTzPickerVisible] = useState(false);
  const [tzPickerOfficeId, setTzPickerOfficeId] = useState<string | null>(null);
  const [tzSearch, setTzSearch] = useState('');

  useEffect(() => {
    if (!user) return;
    loadOrg();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadOrg = async () => {
    if (!user) return;
    const { data: staff } = await supabase
      .from('staff')
      .select('organization_id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!staff) return;
    const orgId = staff.organization_id;

    const { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (orgData) {
      const d = orgData as any;
      const json = (d.settings as Record<string, any>) ?? {};
      setSettings({
        id: d.id,
        name: d.name ?? '',
        slug: d.slug ?? '',
        logo_url: d.logo_url ?? null,
        // Canonical keys live in settings JSON. Fall back to legacy columns
        // (older rows may still have these as top-level columns) so nothing
        // looks empty on first load after the fix.
        check_in_mode: json.default_check_in_mode ?? d.check_in_mode ?? 'self_service',
        ticket_prefix: json.ticket_number_prefix ?? d.ticket_prefix ?? '',
        auto_no_show_minutes: json.auto_no_show_timeout ?? d.auto_no_show_minutes ?? null,
        max_queue_size: json.max_queue_size ?? d.max_queue_size ?? null,
        default_screen_layout: json.default_screen_layout ?? d.default_screen_layout ?? 'list',
        announcement_sound: json.announcement_sound_enabled ?? d.announcement_sound ?? true,
        supported_languages: json.supported_languages ?? d.supported_languages ?? ['en'],
        default_language: json.default_language ?? d.default_language ?? 'en',
        always_open: json.visit_intake_override_mode === 'always_open',
        booking_mode: json.booking_mode ?? 'simple',
        booking_horizon_days: json.booking_horizon_days ?? 7,
        slot_duration_minutes: json.slot_duration_minutes ?? 30,
        slots_per_interval: json.slots_per_interval ?? 1,
        require_appointment_approval: json.require_appointment_approval ?? false,
        require_ticket_approval: json.require_ticket_approval ?? false,
        allow_cancellation: json.allow_cancellation ?? true,
        min_booking_lead_hours: json.min_booking_lead_hours ?? 0,
        daily_ticket_limit: json.daily_ticket_limit ?? null,
        whatsapp_enabled: json.whatsapp_enabled ?? false,
        whatsapp_code: json.whatsapp_code ?? '',
        arabic_code: json.arabic_code ?? '',
        country: (d.country ?? null) as string | null,
        messenger_enabled: json.messenger_enabled ?? false,
        priority_alerts_sms_enabled: json.priority_alerts_sms_enabled ?? false,
        priority_alerts_sms_on_call: json.priority_alerts_sms_on_call ?? true,
        priority_alerts_sms_on_recall: json.priority_alerts_sms_on_recall ?? true,
        priority_alerts_sms_on_buzz: json.priority_alerts_sms_on_buzz ?? true,
        priority_alerts_phone_label: json.priority_alerts_phone_label ?? '',
        email_otp_enabled: json.email_otp_enabled ?? false,
        email_otp_required_for_booking: json.email_otp_required_for_booking ?? false,
      });
    }

    const { data: officeData } = await supabase
      .from('offices')
      .select('id, name, timezone, operating_hours')
      .eq('organization_id', orgId)
      .order('name');
    setOffices((officeData ?? []) as OfficeTimezone[]);
  };

  // ── Work schedule helpers ───────────────────────────────────────
  // Merge a single day's hours into the office's operating_hours JSON
  // and persist. Optimistic local update + DB write.
  const updateOfficeDay = async (officeId: string, day: WeekDay, dayHours: DaySchedule | null) => {
    setOffices((prev) => prev.map((o) => {
      if (o.id !== officeId) return o;
      const current = o.operating_hours ?? {};
      return { ...o, operating_hours: { ...current, [day]: dayHours } };
    }));
    // Re-fetch current JSON then merge to avoid clobbering other days
    const { data: row } = await supabase
      .from('offices')
      .select('operating_hours')
      .eq('id', officeId)
      .single();
    const current = (row?.operating_hours as OperatingHours | null) ?? {};
    const merged: OperatingHours = { ...current, [day]: dayHours };
    const { error } = await supabase.from('offices').update({ operating_hours: merged }).eq('id', officeId);
    if (!error) pulseSaved();
  };

  /**
   * Set `visit_intake_override_mode` at both the org and every office level,
   * mirroring what Station does. This is how 24/7 is actually toggled — NOT
   * via per-day operating_hours. Writing only the org value would leave
   * offices stale, which Station sees as disagreement.
   */
  const setAlwaysOpen = async (on: boolean) => {
    if (!settings) return;
    setSaving(true);
    const newMode = on ? 'always_open' : 'business_hours';

    // Optimistic local state
    setSettings({ ...settings, always_open: on });

    // Org-level write
    const { data: orgRow } = await supabase
      .from('organizations').select('settings').eq('id', settings.id).single();
    const orgSettings = (orgRow?.settings as Record<string, any>) ?? {};
    const orgMerged = { ...orgSettings, visit_intake_override_mode: newMode };
    const { error: orgErr } = await supabase
      .from('organizations').update({ settings: orgMerged }).eq('id', settings.id);

    // Mirror to each office's settings JSON (Station does this for consistency
    // with any office-specific lookups that read from offices.settings)
    const officeIds = offices.map((o) => o.id);
    if (officeIds.length > 0) {
      const { data: officeRows } = await supabase
        .from('offices').select('id, settings').in('id', officeIds);
      if (officeRows) {
        await Promise.all(officeRows.map((row: any) => {
          const s = (row.settings as Record<string, any>) ?? {};
          return supabase
            .from('offices')
            .update({ settings: { ...s, visit_intake_override_mode: newMode } })
            .eq('id', row.id);
        }));
      }
    }
    setSaving(false);
    if (!orgErr) pulseSaved();
  };

  // Bulk: apply the same schedule to multiple days in one DB write.
  // Used by presets ("Mon–Fri 9–5") and "Copy to weekdays" — avoids 5
  // separate round-trips.
  const updateOfficeDays = async (officeId: string, days: WeekDay[], dayHours: DaySchedule) => {
    setOffices((prev) => prev.map((o) => {
      if (o.id !== officeId) return o;
      const current = o.operating_hours ?? {};
      const patch: OperatingHours = { ...current };
      for (const d of days) patch[d] = dayHours;
      return { ...o, operating_hours: patch };
    }));
    const { data: row } = await supabase
      .from('offices')
      .select('operating_hours')
      .eq('id', officeId)
      .single();
    const current = (row?.operating_hours as OperatingHours | null) ?? {};
    const merged: OperatingHours = { ...current };
    for (const d of days) merged[d] = dayHours;
    const { error } = await supabase.from('offices').update({ operating_hours: merged }).eq('id', officeId);
    if (!error) pulseSaved();
  };

  const updateSetting = async (field: string, value: unknown) => {
    if (!settings) return;
    setSaving(true);
    setSettings({ ...settings, [field]: value } as OrgSettings);
    const { error } = await supabase.from('organizations').update({ [field]: value }).eq('id', settings.id);
    setSaving(false);
    if (!error) pulseSaved();
  };

  /**
   * Write a key into organizations.settings JSON.
   * @param dbKey     Canonical Station/web key (what other clients read).
   * @param value     Value to write.
   * @param stateKey  Local React-state field name if it differs from dbKey
   *                  (e.g. DB 'default_check_in_mode' ↔ state 'check_in_mode').
   *                  Defaults to dbKey when omitted.
   */
  const updateSettingsJson = async (dbKey: string, value: unknown, stateKey?: string) => {
    if (!settings) return;
    setSaving(true);
    const { data: orgRow } = await supabase.from('organizations').select('settings').eq('id', settings.id).single();
    const current = (orgRow?.settings as Record<string, any>) ?? {};
    const merged = { ...current, [dbKey]: value };
    const { error } = await supabase.from('organizations').update({ settings: merged }).eq('id', settings.id);
    setSettings({ ...settings, [stateKey ?? dbKey]: value } as any);
    setSaving(false);
    if (!error) pulseSaved();
  };

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
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
    setOffices((prev) => prev.map((o) => (o.id === tzPickerOfficeId ? { ...o, timezone: normalized } : o)));
    setSaving(false);
  };

  if (!settings) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' }}>
          {t('common.loading', { defaultValue: 'Loading…' })}
        </Text>
      </View>
    );
  }

  return (
    <>
      {/* Auto-save indicator — appears briefly after each successful write */}
      {savedVisible && (
        <View pointerEvents="none" style={styles.savedToast}>
          <Ionicons name="checkmark-circle" size={14} color="#fff" />
          <Text style={styles.savedToastText}>{t('adminMore.saved', { defaultValue: 'Saved' })}</Text>
        </View>
      )}
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Organization identity */}
        <CollapsibleSection
          title={t('adminMore.organization', { defaultValue: 'Organization' })}
          icon="business-outline"
          expanded={expandedSection === 'organization'}
          onToggle={() => toggleSection('organization')}
        >
          <SettingRow label={t('adminMore.orgName', { defaultValue: 'Name' })} icon="business-outline">
            <TextInput
              style={styles.input}
              value={settings.name}
              onChangeText={(v) => setSettings({ ...settings, name: v })}
              onBlur={() => updateSetting('name', settings.name)}
              placeholder={t('adminMore.orgNamePlaceholder', { defaultValue: 'Acme Clinic' })}
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>
          <SettingRow label={t('adminMore.orgSlug', { defaultValue: 'Slug (URL)' })} icon="at-outline">
            <TextInput
              style={styles.input}
              value={settings.slug}
              onChangeText={(v) => setSettings({ ...settings, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
              onBlur={() => updateSetting('slug', settings.slug)}
              autoCapitalize="none"
              placeholder="acme-clinic"
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>
          <SettingRow label={t('adminMore.orgLogoUrl', { defaultValue: 'Logo URL' })} icon="image-outline">
            <TextInput
              style={styles.input}
              value={settings.logo_url ?? ''}
              onChangeText={(v) => setSettings({ ...settings, logo_url: v })}
              onBlur={() => updateSetting('logo_url', settings.logo_url || null)}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://..."
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>
        </CollapsibleSection>

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
                  onPress={() => updateSettingsJson('default_check_in_mode', mode, 'check_in_mode')}
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
              onBlur={() => updateSettingsJson('ticket_number_prefix', settings.ticket_prefix, 'ticket_prefix')}
              placeholder={t('adminMore.ticketPrefixPlaceholder')}
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>
          <SettingRow label={t('adminMore.autoNoShow')} icon="timer-outline">
            <TextInput
              style={styles.input}
              value={settings.auto_no_show_minutes?.toString() ?? ''}
              onChangeText={(v) => setSettings({ ...settings, auto_no_show_minutes: v ? parseInt(v) : null })}
              onBlur={() => updateSettingsJson('auto_no_show_timeout', settings.auto_no_show_minutes, 'auto_no_show_minutes')}
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
              onBlur={() => updateSettingsJson('max_queue_size', settings.max_queue_size)}
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
                  onPress={() => updateSettingsJson('default_screen_layout', layout)}
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
              onValueChange={(v) => updateSettingsJson('announcement_sound_enabled', v, 'announcement_sound')}
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
                    updateSettingsJson('default_language', lang);
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
                  onChangeText={(v) => setSettings({ ...settings, booking_horizon_days: parseInt(v) || 7 })}
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
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, minWidth: 55, textAlign: 'center' }}>
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
                  onChangeText={(v) => setSettings({ ...settings, slots_per_interval: parseInt(v) || 1 })}
                  onBlur={() => updateSettingsJson('slots_per_interval', settings.slots_per_interval)}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                />
              </SettingRow>
            </>
          )}

          <SettingRow label={t('adminMore.requireAppointmentApproval', { defaultValue: 'Require appointment approval' })} icon="checkmark-circle-outline">
            <Switch value={settings.require_appointment_approval} onValueChange={(v) => updateSettingsJson('require_appointment_approval', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
          </SettingRow>
          <SettingRow label={t('adminMore.requireTicketApproval', { defaultValue: 'Require ticket approval' })} icon="shield-checkmark-outline">
            <Switch value={settings.require_ticket_approval} onValueChange={(v) => updateSettingsJson('require_ticket_approval', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
          </SettingRow>
          <SettingRow label={t('adminMore.allowCancellation', { defaultValue: 'Allow cancellation' })} icon="close-circle-outline">
            <Switch value={settings.allow_cancellation} onValueChange={(v) => updateSettingsJson('allow_cancellation', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
          </SettingRow>
          <SettingRow label={t('adminMore.minLeadHours', { defaultValue: 'Min lead time (hours)' })} icon="hourglass-outline">
            <TextInput
              style={styles.input}
              value={String(settings.min_booking_lead_hours)}
              onChangeText={(v) => setSettings({ ...settings, min_booking_lead_hours: parseInt(v) || 0 })}
              onBlur={() => updateSettingsJson('min_booking_lead_hours', settings.min_booking_lead_hours)}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>
          <SettingRow label={t('adminMore.dailyTicketLimit', { defaultValue: 'Daily ticket limit' })} icon="layers-outline">
            <TextInput
              style={styles.input}
              value={settings.daily_ticket_limit?.toString() ?? ''}
              onChangeText={(v) => setSettings({ ...settings, daily_ticket_limit: v ? parseInt(v) : null })}
              onBlur={() => updateSettingsJson('daily_ticket_limit', settings.daily_ticket_limit)}
              keyboardType="number-pad"
              placeholder={t('adminMore.unlimited')}
              placeholderTextColor={colors.textMuted}
            />
          </SettingRow>
        </CollapsibleSection>

        {/* WhatsApp — business phone is managed centrally by QFlo; only the
            join keywords (EN + AR) are editable per organization. */}
        <CollapsibleSection title={t('adminMore.whatsapp', { defaultValue: 'WhatsApp' })} icon="logo-whatsapp" expanded={expandedSection === 'whatsapp'} onToggle={() => toggleSection('whatsapp')}>
          <SettingRow label={t('adminMore.whatsappEnabled', { defaultValue: 'Enable WhatsApp' })} icon="toggle-outline">
            <Switch value={settings.whatsapp_enabled} onValueChange={(v) => updateSettingsJson('whatsapp_enabled', v)} trackColor={{ false: '#e2e8f0', true: '#25D366' }} thumbColor="#fff" />
          </SettingRow>
          {settings.whatsapp_enabled && (
            <>
              <SettingRow label={t('adminMore.whatsappCode', { defaultValue: 'Join keyword (EN)' })} icon="pricetag-outline">
                <TextInput
                  style={styles.input}
                  value={settings.whatsapp_code}
                  onChangeText={(v) => setSettings({ ...settings, whatsapp_code: v })}
                  onBlur={() => updateSettingsJson('whatsapp_code', settings.whatsapp_code)}
                  autoCapitalize="characters"
                  placeholder="JOIN"
                  placeholderTextColor={colors.textMuted}
                />
              </SettingRow>
              {isArabicCountry(settings.country) && (
              <SettingRow label={t('adminMore.arabicCode', { defaultValue: 'Join keyword (AR)' })} icon="pricetag-outline">
                <TextInput
                  style={[styles.input, { textAlign: 'right', writingDirection: 'rtl' }]}
                  value={settings.arabic_code}
                  onChangeText={(v) => setSettings({ ...settings, arabic_code: v })}
                  onBlur={() => updateSettingsJson('arabic_code', settings.arabic_code)}
                  autoCapitalize="none"
                  placeholder="انضم"
                  placeholderTextColor={colors.textMuted}
                />
              </SettingRow>
              )}
            </>
          )}
        </CollapsibleSection>

        {/* Messenger — FB Page ID is managed centrally; only the enable
            toggle is exposed per organization. */}
        <CollapsibleSection title={t('adminMore.messenger', { defaultValue: 'Messenger' })} icon="chatbubble-ellipses-outline" expanded={expandedSection === 'messenger'} onToggle={() => toggleSection('messenger')}>
          <SettingRow label={t('adminMore.messengerEnabled', { defaultValue: 'Enable Messenger' })} icon="toggle-outline">
            <Switch value={settings.messenger_enabled} onValueChange={(v) => updateSettingsJson('messenger_enabled', v)} trackColor={{ false: '#e2e8f0', true: '#0084FF' }} thumbColor="#fff" />
          </SettingRow>
        </CollapsibleSection>

        {/* Work Schedule — per-office weekly hours (mirrors Station schema).
            Each day: open/close times, optional midday break, closed toggle. */}
        <CollapsibleSection
          title={t('adminMore.workSchedule', { defaultValue: 'Work schedule' })}
          icon="calendar-number-outline"
          expanded={expandedSection === 'schedule'}
          onToggle={() => toggleSection('schedule')}
        >
          {offices.length === 0 ? (
            <Text style={{ color: colors.textMuted, fontSize: fontSize.sm, padding: spacing.sm }}>
              {t('adminMore.noOfficesFound')}
            </Text>
          ) : (
            offices.map((office) => (
              <OfficeSchedule
                key={office.id}
                office={office}
                alwaysOpen={settings.always_open}
                onUpdateDay={(day, hours) => updateOfficeDay(office.id, day, hours)}
                onBulkApply={(days, hours) => updateOfficeDays(office.id, days, hours)}
                onSetAlwaysOpen={setAlwaysOpen}
                t={t}
              />
            ))
          )}
        </CollapsibleSection>

        {/* Priority SMS alerts */}
        <CollapsibleSection title={t('adminMore.priorityAlerts', { defaultValue: 'Priority SMS alerts' })} icon="notifications-outline" expanded={expandedSection === 'priorityAlerts'} onToggle={() => toggleSection('priorityAlerts')}>
          <SettingRow label={t('adminMore.enableSmsAlerts', { defaultValue: 'Enable SMS alerts' })} icon="chatbox-outline">
            <Switch value={settings.priority_alerts_sms_enabled} onValueChange={(v) => updateSettingsJson('priority_alerts_sms_enabled', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
          </SettingRow>
          {settings.priority_alerts_sms_enabled && (
            <>
              <SettingRow label={t('adminMore.alertOnCall', { defaultValue: 'On call' })} icon="megaphone-outline">
                <Switch value={settings.priority_alerts_sms_on_call} onValueChange={(v) => updateSettingsJson('priority_alerts_sms_on_call', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
              </SettingRow>
              <SettingRow label={t('adminMore.alertOnRecall', { defaultValue: 'On recall' })} icon="volume-high-outline">
                <Switch value={settings.priority_alerts_sms_on_recall} onValueChange={(v) => updateSettingsJson('priority_alerts_sms_on_recall', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
              </SettingRow>
              <SettingRow label={t('adminMore.alertOnBuzz', { defaultValue: 'On buzz' })} icon="flash-outline">
                <Switch value={settings.priority_alerts_sms_on_buzz} onValueChange={(v) => updateSettingsJson('priority_alerts_sms_on_buzz', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
              </SettingRow>
              <SettingRow label={t('adminMore.phoneLabel', { defaultValue: 'Phone field label' })} icon="text-outline">
                <TextInput style={styles.input} value={settings.priority_alerts_phone_label} onChangeText={(v) => setSettings({ ...settings, priority_alerts_phone_label: v })} onBlur={() => updateSettingsJson('priority_alerts_phone_label', settings.priority_alerts_phone_label)} placeholder={t('adminMore.phoneLabelPlaceholder', { defaultValue: 'e.g. Mobile number' })} placeholderTextColor={colors.textMuted} />
              </SettingRow>
            </>
          )}
        </CollapsibleSection>

        {/* Email OTP */}
        <CollapsibleSection title={t('adminMore.emailOtp', { defaultValue: 'Email verification (OTP)' })} icon="mail-outline" expanded={expandedSection === 'emailOtp'} onToggle={() => toggleSection('emailOtp')}>
          <SettingRow label={t('adminMore.emailOtpEnabled', { defaultValue: 'Enable email OTP' })} icon="toggle-outline">
            <Switch value={settings.email_otp_enabled} onValueChange={(v) => updateSettingsJson('email_otp_enabled', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
          </SettingRow>
          {settings.email_otp_enabled && (
            <SettingRow label={t('adminMore.emailOtpRequiredForBooking', { defaultValue: 'Required for booking' })} icon="lock-closed-outline">
              <Switch value={settings.email_otp_required_for_booking} onValueChange={(v) => updateSettingsJson('email_otp_required_for_booking', v)} trackColor={{ false: '#e2e8f0', true: colors.primary }} thumbColor="#fff" />
            </SettingRow>
          )}
        </CollapsibleSection>

        {/* Office Timezones */}
        <CollapsibleSection title={t('adminMore.officeTimezones')} icon="time-outline" expanded={expandedSection === 'timezone'} onToggle={() => toggleSection('timezone')}>
          {offices.length === 0 ? (
            <Text style={{ color: colors.textMuted, fontSize: fontSize.sm, padding: spacing.sm }}>
              {t('adminMore.noOfficesFound')}
            </Text>
          ) : (
            offices.map((office) => (
              <View key={office.id} style={styles.tzRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tzOfficeName}>{office.name}</Text>
                  <Text style={styles.tzValue}>{office.timezone ?? t('adminMore.notSet')}</Text>
                </View>
                <TouchableOpacity style={styles.tzChangeBtn} onPress={() => openTzPicker(office.id)}>
                  <Ionicons name="create-outline" size={16} color={colors.primary} />
                  <Text style={styles.tzChangeBtnText}>{t('adminMore.change')}</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </CollapsibleSection>
      </ScrollView>

      {/* Timezone Picker Modal */}
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
            data={TIMEZONE_OPTIONS.filter((tz) => tz.toLowerCase().includes(tzSearch.toLowerCase()))}
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
    </>
  );
}

/* ── Subcomponents ────────────────────────────────────────────────── */

/**
 * OfficeSchedule — upgraded weekly hours editor for one office.
 *
 * UX upgrades over v1:
 *  - Tap a time pill → native-feeling wheel picker (no keyboard typing)
 *  - Presets row: apply common schedules in one tap
 *  - Per-day "copy to weekdays" shortcut to avoid typing 5× the same hours
 *  - Closed days collapse to a single dim row (no wasted vertical space)
 *  - Clear Open/Closed toggle with a full-width pill, not a tiny corner chip
 */
function OfficeSchedule({
  office,
  alwaysOpen,
  onUpdateDay,
  onBulkApply,
  onSetAlwaysOpen,
  t,
}: {
  office: OfficeTimezone;
  alwaysOpen: boolean;
  onUpdateDay: (day: WeekDay, hours: DaySchedule | null) => Promise<void> | void;
  onBulkApply: (days: WeekDay[], hours: DaySchedule) => Promise<void> | void;
  onSetAlwaysOpen: (on: boolean) => Promise<void> | void;
  t: (key: string, opts?: any) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<{
    day: WeekDay;
    field: 'open' | 'close' | 'break_start' | 'break_end';
    current: string;
  } | null>(null);

  const hours = office.operating_hours ?? {};
  const getDay = (day: WeekDay): DaySchedule => hours[day] ?? CLOSED_HOURS;
  // When the org-level 24/7 flag is on, that wins regardless of day grid.
  const activePreset: PresetKey = alwaysOpen ? 'always' : matchingPreset(hours);

  // Any manual day edit implicitly disables the org-level 24/7 override —
  // otherwise Station would ignore the per-day hours the user just set.
  const ensureDayGridMode = () => {
    if (alwaysOpen) onSetAlwaysOpen(false);
  };

  const toggleClosed = (day: WeekDay) => {
    ensureDayGridMode();
    const current = getDay(day);
    onUpdateDay(day, isDayClosed(current) ? DEFAULT_HOURS : CLOSED_HOURS);
  };

  const toggleBreak = (day: WeekDay) => {
    const current = getDay(day);
    if (current.break_start) {
      const next = { ...current };
      delete next.break_start;
      delete next.break_end;
      onUpdateDay(day, next);
    } else {
      onUpdateDay(day, { ...current, break_start: '12:00', break_end: '13:00' });
    }
  };

  const copyToWeekdays = (day: WeekDay) => {
    const src = getDay(day);
    if (isDayClosed(src)) return;
    const weekdays: WeekDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    onBulkApply(weekdays, src);
  };

  const applyPreset = (preset: 'weekdays' | 'mon_sat' | 'all_week' | 'always') => {
    if (preset === 'always') {
      // 24/7 is an org-level override, NOT a per-day hours write. This is
      // how Station stores it — any other approach creates disagreement.
      onSetAlwaysOpen(true);
      return;
    }
    // Any non-24/7 preset: ensure always_open is OFF so the day grid applies.
    if (alwaysOpen) onSetAlwaysOpen(false);
    if (preset === 'weekdays') {
      onBulkApply(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], { open: '09:00', close: '17:00' });
      onBulkApply(['saturday', 'sunday'], CLOSED_HOURS);
    } else if (preset === 'mon_sat') {
      onBulkApply(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], { open: '09:00', close: '18:00' });
      onBulkApply(['sunday'], CLOSED_HOURS);
    } else if (preset === 'all_week') {
      onBulkApply(WEEK_DAYS.map((d) => d.key), { open: '09:00', close: '18:00' });
    }
  };

  const commitPicker = (newTime: string) => {
    if (!picker) return;
    ensureDayGridMode();
    const day = getDay(picker.day);
    const updated = { ...day, [picker.field]: newTime };
    onUpdateDay(picker.day, updated);
    setPicker(null);
  };

  return (
    <View style={scheduleStyles.officeBlock}>
      <TouchableOpacity
        style={scheduleStyles.officeHeader}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <Ionicons name="location-outline" size={16} color={colors.primary} />
        <Text style={scheduleStyles.officeName}>{office.name}</Text>
        <View style={{ flex: 1 }} />
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={scheduleStyles.body}>
          {/* Presets row — one-tap common schedules */}
          <View style={scheduleStyles.presetsRow}>
            <Text style={scheduleStyles.presetsLabel}>
              {t('adminMore.presets', { defaultValue: 'Quick presets' })}:
            </Text>
            <View style={scheduleStyles.presetsChips}>
              <PresetChip
                label={t('adminMore.presetWeekdays', { defaultValue: 'Mon–Fri 9–5' })}
                active={activePreset === 'weekdays'}
                onPress={() => applyPreset('weekdays')}
              />
              <PresetChip
                label={t('adminMore.presetMonSat', { defaultValue: 'Mon–Sat 9–6' })}
                active={activePreset === 'mon_sat'}
                onPress={() => applyPreset('mon_sat')}
              />
              <PresetChip
                label={t('adminMore.presetAlwaysOpen', { defaultValue: '24/7' })}
                active={activePreset === 'always'}
                onPress={() => applyPreset('always')}
              />
            </View>
          </View>

          {/* When 24/7 is on, the day grid is irrelevant — show a banner.
              Any edit below would auto-disable the override anyway. */}
          {alwaysOpen && (
            <View style={scheduleStyles.alwaysOpenBanner}>
              <Ionicons name="time" size={16} color={colors.success} />
              <Text style={scheduleStyles.alwaysOpenBannerText}>
                {t('adminMore.alwaysOpenBanner', { defaultValue: 'Open 24/7 — day schedule is overridden' })}
              </Text>
            </View>
          )}

          {/* Day rows */}
          {!alwaysOpen && (
          <View style={scheduleStyles.days}>
            {WEEK_DAYS.map(({ key, labelKey }) => {
              const day = getDay(key);
              const closed = isDayClosed(day);
              const hasBreak = !!day.break_start;

              return (
                <View key={key} style={[scheduleStyles.dayRow, closed && scheduleStyles.dayRowClosed]}>
                  {/* Header: day name + Open/Closed pill */}
                  <View style={scheduleStyles.dayHeader}>
                    <Text style={[scheduleStyles.dayLabel, closed && scheduleStyles.dayLabelClosed]}>
                      {t(labelKey)}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity
                      onPress={() => toggleClosed(key)}
                      activeOpacity={0.7}
                      style={[scheduleStyles.statePill, closed ? scheduleStyles.statePillClosed : scheduleStyles.statePillOpen]}
                    >
                      <View style={[scheduleStyles.stateDot, { backgroundColor: closed ? colors.textMuted : colors.success }]} />
                      <Text style={[scheduleStyles.statePillText, { color: closed ? colors.textMuted : colors.success }]}>
                        {closed ? t('adminMore.closed', { defaultValue: 'Closed' }) : t('adminMore.open', { defaultValue: 'Open' })}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Expanded controls only when open */}
                  {!closed && (
                    <>
                      {/* Open – Close time row */}
                      <View style={scheduleStyles.timeRow}>
                        <TimePill
                          label={t('adminMore.openTime', { defaultValue: 'Open' })}
                          value={day.open}
                          onPress={() => setPicker({ day: key, field: 'open', current: day.open })}
                        />
                        <Text style={scheduleStyles.timeSep}>→</Text>
                        <TimePill
                          label={t('adminMore.closeTime', { defaultValue: 'Close' })}
                          value={day.close}
                          onPress={() => setPicker({ day: key, field: 'close', current: day.close })}
                        />
                      </View>

                      {/* Break toggle + inputs */}
                      {hasBreak ? (
                        <View style={scheduleStyles.timeRow}>
                          <View style={scheduleStyles.breakLeadIcon}>
                            <Ionicons name="cafe" size={13} color={colors.warning} />
                            <Text style={[scheduleStyles.breakText, { color: colors.warning }]}>
                              {t('adminMore.breakStart', { defaultValue: 'Break' })}
                            </Text>
                          </View>
                          <TimePill
                            value={day.break_start ?? '12:00'}
                            onPress={() => setPicker({ day: key, field: 'break_start', current: day.break_start ?? '12:00' })}
                            accent={colors.warning}
                          />
                          <Text style={scheduleStyles.timeSep}>→</Text>
                          <TimePill
                            value={day.break_end ?? '13:00'}
                            onPress={() => setPicker({ day: key, field: 'break_end', current: day.break_end ?? '13:00' })}
                            accent={colors.warning}
                          />
                          <TouchableOpacity onPress={() => toggleBreak(key)} hitSlop={10} style={{ marginLeft: 4 }}>
                            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={scheduleStyles.subActions}>
                          <TouchableOpacity onPress={() => toggleBreak(key)} activeOpacity={0.7} style={scheduleStyles.subAction}>
                            <Ionicons name="cafe-outline" size={13} color={colors.textMuted} />
                            <Text style={scheduleStyles.subActionText}>
                              {t('adminMore.addBreak', { defaultValue: 'Add break' })}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => copyToWeekdays(key)} activeOpacity={0.7} style={scheduleStyles.subAction}>
                            <Ionicons name="copy-outline" size={13} color={colors.textMuted} />
                            <Text style={scheduleStyles.subActionText}>
                              {t('adminMore.copyToWeekdays', { defaultValue: 'Copy to Mon–Fri' })}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </>
                  )}
                </View>
              );
            })}
          </View>
          )}
        </View>
      )}

      {/* Time picker modal */}
      <TimePickerModal
        visible={!!picker}
        initial={picker?.current ?? '00:00'}
        onCancel={() => setPicker(null)}
        onDone={commitPicker}
        t={t}
      />
    </View>
  );
}

function PresetChip({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[scheduleStyles.presetChip, active && scheduleStyles.presetChipActive]}
    >
      {active && <Ionicons name="checkmark" size={12} color="#fff" style={{ marginRight: 2 }} />}
      <Text style={[scheduleStyles.presetChipText, active && scheduleStyles.presetChipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TimePill({
  label,
  value,
  onPress,
  accent,
}: {
  label?: string;
  value: string;
  onPress: () => void;
  accent?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[scheduleStyles.timePill, accent ? { borderColor: accent + '55', backgroundColor: accent + '10' } : null]}
    >
      {label && <Text style={scheduleStyles.timePillLabel}>{label}</Text>}
      <Text style={[scheduleStyles.timePillValue, accent ? { color: accent } : null]}>{value}</Text>
    </TouchableOpacity>
  );
}

/**
 * TimePickerModal — bottom-sheet hour/minute picker.
 * Pure-JS, no native dep. Scrollable hour column + minute column in 5-min
 * increments, snap-to-item. "Done" commits.
 */
function TimePickerModal({
  visible,
  initial,
  onCancel,
  onDone,
  t,
}: {
  visible: boolean;
  initial: string;
  onCancel: () => void;
  onDone: (time: string) => void;
  t: (key: string, opts?: any) => string;
}) {
  const [h, m] = initial.split(':');
  const [hour, setHour] = useState(h ?? '09');
  const [minute, setMinute] = useState(m ?? '00');

  // Reset whenever a new field is opened
  useEffect(() => {
    const [ih, im] = (initial ?? '00:00').split(':');
    setHour(ih ?? '00');
    setMinute(im ?? '00');
  }, [initial, visible]);

  const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

  const done = () => onDone(`${hour}:${minute}`);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <TouchableOpacity activeOpacity={1} onPress={onCancel} style={pickerStyles.backdrop}>
        <TouchableOpacity activeOpacity={1} style={pickerStyles.sheet}>
          <View style={pickerStyles.header}>
            <TouchableOpacity onPress={onCancel} hitSlop={10}>
              <Text style={pickerStyles.headerCancel}>{t('common.cancel', { defaultValue: 'Cancel' })}</Text>
            </TouchableOpacity>
            <Text style={pickerStyles.headerTitle}>
              {t('adminMore.pickTime', { defaultValue: 'Pick time' })}
            </Text>
            <TouchableOpacity onPress={done} hitSlop={10}>
              <Text style={pickerStyles.headerDone}>{t('common.done', { defaultValue: 'Done' })}</Text>
            </TouchableOpacity>
          </View>

          <View style={pickerStyles.preview}>
            <Text style={pickerStyles.previewText}>
              {hour}:{minute}
            </Text>
          </View>

          <View style={pickerStyles.wheels}>
            <WheelColumn items={HOURS} value={hour} onChange={setHour} />
            <Text style={pickerStyles.wheelSep}>:</Text>
            <WheelColumn items={MINUTES} value={minute} onChange={setMinute} />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/** Vertical scrollable wheel that snaps the selection to the center. */
function WheelColumn({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const ITEM_HEIGHT = 44;
  const scrollRef = useRef<ScrollView>(null);

  // Scroll to current value on mount + when value changes externally
  useEffect(() => {
    const idx = items.indexOf(value);
    if (idx >= 0 && scrollRef.current) {
      // Defer so ScrollView has laid out
      setTimeout(() => scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: false }), 0);
    }
  }, [value, items]);

  const onMomentumScrollEnd = (e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ITEM_HEIGHT);
    const next = items[Math.max(0, Math.min(items.length - 1, idx))];
    if (next && next !== value) onChange(next);
  };

  return (
    <View style={pickerStyles.wheelCol}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumScrollEnd}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
      >
        {items.map((item) => (
          <TouchableOpacity
            key={item}
            style={{ height: ITEM_HEIGHT, justifyContent: 'center', alignItems: 'center' }}
            onPress={() => {
              onChange(item);
              const idx = items.indexOf(item);
              scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: true });
            }}
          >
            <Text
              style={[
                pickerStyles.wheelItem,
                item === value && pickerStyles.wheelItemActive,
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {/* Center highlight overlay */}
      <View pointerEvents="none" style={pickerStyles.wheelHighlight} />
    </View>
  );
}

const scheduleStyles = StyleSheet.create({
  officeBlock: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  officeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surfaceSecondary,
  },
  officeName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  body: { padding: spacing.sm, gap: spacing.sm },

  presetsRow: {
    gap: 6,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  presetsLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  presetsChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryLight + '15',
    borderWidth: 1,
    borderColor: colors.primary + '33',
  },
  presetChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  presetChipText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  presetChipTextActive: { color: '#fff' },

  alwaysOpenBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.success + '12',
    borderWidth: 1,
    borderColor: colors.success + '33',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  alwaysOpenBannerText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.success,
  },
  days: { gap: 2 },
  dayRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: 8,
  },
  dayRowClosed: { opacity: 0.55, gap: 0 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, minWidth: 78 },
  dayLabelClosed: { color: colors.textMuted, fontWeight: '600' },

  statePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statePillOpen: { backgroundColor: colors.success + '12' },
  statePillClosed: { backgroundColor: colors.textMuted + '15' },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  statePillText: { fontSize: 11, fontWeight: '700' },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  timeSep: { fontSize: fontSize.md, color: colors.textMuted, fontWeight: '500' },

  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 80,
  },
  timePillLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  timePillValue: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'] as any,
  },

  breakLeadIcon: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 78 },
  breakText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },

  subActions: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  subAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  subActionText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
});

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCancel: { fontSize: fontSize.md, color: colors.textSecondary, fontWeight: '500' },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  headerDone: { fontSize: fontSize.md, color: colors.primary, fontWeight: '700' },
  preview: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  previewText: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'] as any,
    letterSpacing: 1,
  },
  wheels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 220,
  },
  wheelCol: { width: 80, height: 220, position: 'relative' },
  wheelSep: { fontSize: 28, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 4 },
  wheelItem: { fontSize: fontSize.lg, color: colors.textMuted, fontVariant: ['tabular-nums'] as any, fontWeight: '600' },
  wheelItemActive: { color: colors.primary, fontSize: 26, fontWeight: '800' },
  wheelHighlight: {
    position: 'absolute',
    top: 88,
    left: 0,
    right: 0,
    height: 44,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.primary + '08',
  },
});

function CollapsibleSection({
  title, icon, expanded, onToggle, children,
}: { title: string; icon: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.collapsibleHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.collapsibleLeft}>
          <Ionicons name={icon as any} size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
      </TouchableOpacity>
      {expanded && <View style={styles.collapsibleBody}>{children}</View>}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  // Auto-save toast (top-right, auto-hides)
  savedToast: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    backgroundColor: colors.success,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  savedToastText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: '700',
  },

  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapsibleLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  collapsibleBody: { marginTop: spacing.md, gap: spacing.md },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },

  settingRow: { gap: spacing.xs },
  settingLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  settingLabelText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
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
