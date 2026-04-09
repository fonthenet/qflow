import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';

interface Props {
  organizationId: string;
  officeId?: string;
  locale: DesktopLocale;
  storedAuth?: { access_token?: string; refresh_token?: string; email?: string; password?: string };
  officeName?: string;
  onClose: () => void;
  onSaved?: () => void;
}

const WEEK_DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
] as const;

const TIMEZONES = [
  { value: 'Africa/Algiers', label: 'Africa/Algiers (UTC+1)' },
  { value: 'Africa/Casablanca', label: 'Africa/Casablanca (UTC+0/+1)' },
  { value: 'Africa/Cairo', label: 'Africa/Cairo (UTC+2)' },
  { value: 'Africa/Tunis', label: 'Africa/Tunis (UTC+1)' },
  { value: 'Africa/Lagos', label: 'Africa/Lagos (UTC+1)' },
  { value: 'Africa/Nairobi', label: 'Africa/Nairobi (UTC+3)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (UTC+2)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (UTC+1/+2)' },
  { value: 'Europe/London', label: 'Europe/London (UTC+0/+1)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (UTC+1/+2)' },
  { value: 'Europe/Istanbul', label: 'Europe/Istanbul (UTC+3)' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow (UTC+3)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (UTC+4)' },
  { value: 'Asia/Riyadh', label: 'Asia/Riyadh (UTC+3)' },
  { value: 'Asia/Beirut', label: 'Asia/Beirut (UTC+2/+3)' },
  { value: 'America/New_York', label: 'America/New_York (UTC-5/-4)' },
  { value: 'America/Chicago', label: 'America/Chicago (UTC-6/-5)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-8/-7)' },
  { value: 'America/Toronto', label: 'America/Toronto (UTC-5/-4)' },
  { value: 'UTC', label: 'UTC' },
];

type SettingsShape = Record<string, any>;

type FieldType = 'bool' | 'num' | 'text' | 'textarea' | 'enum' | 'multi';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  default: any;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
  unlimitedWhenZero?: boolean;
  placeholder?: string;
}

interface SectionDef {
  id: string;
  icon: string;
  title: string;
  fields: FieldDef[];
}

// ─── Helpers ───────────────────────────────────────────────────────────
function coerceBool(v: any, def: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return def;
}
function coerceNum(v: any, def: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function coerceStr(v: any, def: string): string {
  if (v == null) return def;
  return String(v);
}
function coerceArr(v: any, def: string[]): string[] {
  if (Array.isArray(v)) return v.map(String);
  return def;
}

// ─── Component ─────────────────────────────────────────────────────────
export function SettingsModal({ organizationId, officeId, locale, storedAuth, officeName, onClose, onSaved }: Props) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const orgIdRef = useRef<string>('');
  const originalRef = useRef<SettingsShape>({});

  // Org-level non-settings fields
  const [orgName, setOrgName] = useState<string>('');
  const [originalOrgName, setOriginalOrgName] = useState<string>('');

  // Office-level: timezone + operating hours
  const [officeTimezone, setOfficeTimezone] = useState<string>('Africa/Algiers');
  const [originalTimezone, setOriginalTimezone] = useState<string>('Africa/Algiers');
  type DaySchedule = { open: string; close: string; closed: boolean };
  const defaultSchedule: Record<string, DaySchedule> = Object.fromEntries(
    WEEK_DAYS.map(d => [d.key, { open: '08:00', close: '17:00', closed: d.key === 'friday' || d.key === 'saturday' }]),
  );
  const [schedule, setSchedule] = useState<Record<string, DaySchedule>>(defaultSchedule);
  const [originalSchedule, setOriginalSchedule] = useState<Record<string, DaySchedule>>(defaultSchedule);

  // All settings values stored in a single map (string->any)
  const [values, setValues] = useState<Record<string, any>>({});

  // ─── Section & field definitions ─────────────────────────────────
  const sections: SectionDef[] = useMemo(() => [
    {
      id: 'business',
      icon: '🏢',
      title: t('sm.section.business'),
      fields: [
        // Org name handled separately (not in settings jsonb)
        { key: 'business_category', label: t('sm.field.business_category'), type: 'enum', default: 'other', options: [
          { value: 'clinic', label: t('sm.cat.clinic') },
          { value: 'dentist', label: t('sm.cat.dentist') },
          { value: 'pharmacy', label: t('sm.cat.pharmacy') },
          { value: 'salon', label: t('sm.cat.salon') },
          { value: 'barber', label: t('sm.cat.barber') },
          { value: 'restaurant', label: t('sm.cat.restaurant') },
          { value: 'cafe', label: t('sm.cat.cafe') },
          { value: 'retail', label: t('sm.cat.retail') },
          { value: 'office', label: t('sm.cat.office') },
          { value: 'government', label: t('sm.cat.government') },
          { value: 'bank', label: t('sm.cat.bank') },
          { value: 'other', label: t('sm.cat.other') },
        ]},
        { key: 'business_description', label: t('sm.field.description'), type: 'textarea', default: '' },
        { key: 'business_website', label: t('sm.field.website'), type: 'text', default: '', placeholder: 'https://example.com' },
        { key: 'business_phone', label: t('sm.field.business_phone'), type: 'text', default: '' },
        { key: 'business_email', label: t('sm.field.business_email'), type: 'text', default: '' },
        { key: 'business_address', label: t('sm.field.address'), type: 'textarea', default: '' },
        { key: 'listed_in_directory', label: t('sm.field.listed_in_directory'), type: 'bool', default: false, help: t('sm.help.listed_in_directory') },
      ],
    },
    {
      id: 'booking',
      icon: '📅',
      title: t('sm.section.booking'),
      fields: [
        // booking_mode is a bool-like (enabled/disabled) — handled specially
        { key: 'booking_mode', label: t('sm.field.booking_enabled'), type: 'bool', default: false },
        { key: 'slot_duration_minutes', label: t('sm.field.slot_duration'), type: 'num', default: 30, min: 5, step: 5 },
        { key: 'slots_per_interval', label: t('sm.field.slots_per_interval'), type: 'num', default: 1, min: 1 },
        { key: 'daily_ticket_limit', label: t('sm.field.daily_limit'), type: 'num', default: 0, min: 0, unlimitedWhenZero: true },
        { key: 'booking_horizon_days', label: t('sm.field.horizon_days'), type: 'num', default: 7, min: 1 },
        { key: 'min_booking_lead_hours', label: t('sm.field.lead_hours'), type: 'num', default: 1, min: 0 },
        { key: 'max_advance_hours', label: t('sm.field.max_advance_hours'), type: 'num', default: 0, min: 0, unlimitedWhenZero: true },
        { key: 'booking_buffer_minutes', label: t('sm.field.buffer_minutes'), type: 'num', default: 0, min: 0 },
        { key: 'allow_cancellation', label: t('sm.field.allow_cancel'), type: 'bool', default: true },
        { key: 'cancellation_window_hours', label: t('sm.field.cancel_window'), type: 'num', default: 2, min: 0 },
        { key: 'require_customer_phone', label: t('sm.field.require_phone'), type: 'bool', default: true },
        { key: 'require_customer_email', label: t('sm.field.require_email'), type: 'bool', default: false },
        { key: 'require_appointment_approval', label: t('sm.field.require_appointment_approval'), type: 'bool', default: true, help: t('sm.help.require_appointment_approval') },
      ],
    },
    {
      id: 'ticketing',
      icon: '🎫',
      title: t('sm.section.ticketing'),
      fields: [
        { key: 'ticket_number_prefix', label: t('sm.field.ticket_prefix'), type: 'text', default: '', placeholder: 'A' },
        { key: 'ticket_number_format', label: t('sm.field.ticket_format'), type: 'enum', default: 'numeric', options: [
          { value: 'numeric', label: t('sm.fmt.numeric') },
          { value: 'prefix_numeric', label: t('sm.fmt.prefix_numeric') },
          { value: 'date_numeric', label: t('sm.fmt.date_numeric') },
        ]},
        { key: 'max_queue_size', label: t('sm.field.max_queue_size'), type: 'num', default: 50, min: 0, unlimitedWhenZero: true },
        { key: 'auto_no_show_timeout', label: t('sm.field.auto_no_show'), type: 'num', default: 10, min: 0, help: t('sm.help.auto_no_show') },
        { key: 'default_check_in_mode', label: t('sm.field.check_in_mode'), type: 'enum', default: 'manual', options: [
          { value: 'manual', label: t('sm.checkin.manual') },
          { value: 'auto', label: t('sm.checkin.auto') },
          { value: 'qr', label: t('sm.checkin.qr') },
        ]},
        { key: 'show_estimated_wait', label: t('sm.field.show_estimated_wait'), type: 'bool', default: true },
        { key: 'display_wait_time', label: t('sm.field.display_wait_time'), type: 'bool', default: true },
        { key: 'require_ticket_approval', label: t('sm.field.require_ticket_approval'), type: 'bool', default: false, help: t('sm.help.require_ticket_approval') },
      ],
    },
    {
      id: 'channels',
      icon: '📱',
      title: t('sm.section.channels'),
      fields: [
        { key: 'whatsapp_enabled', label: t('sm.field.whatsapp'), type: 'bool', default: false },
        { key: 'messenger_enabled', label: t('sm.field.messenger'), type: 'bool', default: false },
        { key: 'web_enabled', label: t('sm.field.web_booking'), type: 'bool', default: true },
        { key: 'kiosk_enabled', label: t('sm.field.kiosk'), type: 'bool', default: false },
        { key: 'qr_code_enabled', label: t('sm.field.qr_code'), type: 'bool', default: true },
        { key: 'virtual_queue_enabled', label: t('sm.field.virtual_queue'), type: 'bool', default: false },
      ],
    },
    {
      id: 'notifications',
      icon: '🔔',
      title: t('sm.section.notifications'),
      fields: [
        { key: 'sms_reminders_enabled', label: t('sm.field.sms_reminders'), type: 'bool', default: false },
        { key: 'whatsapp_reminders_enabled', label: t('sm.field.wa_reminders'), type: 'bool', default: false },
        { key: 'reminder_lead_minutes', label: t('sm.field.reminder_lead'), type: 'num', default: 30, min: 0 },
        { key: 'priority_alerts_sms_enabled', label: t('sm.field.priority_alerts'), type: 'bool', default: false },
        { key: 'priority_alerts_sms_on_call', label: t('sm.field.alert_on_call'), type: 'bool', default: true },
        { key: 'priority_alerts_sms_on_recall', label: t('sm.field.alert_on_recall'), type: 'bool', default: true },
        { key: 'priority_alerts_sms_on_buzz', label: t('sm.field.alert_on_buzz'), type: 'bool', default: true },
        { key: 'staff_notifications_enabled', label: t('sm.field.staff_notifications'), type: 'bool', default: true },
      ],
    },
    {
      id: 'display',
      icon: '🖥',
      title: t('sm.section.display'),
      fields: [
        { key: 'default_display_layout', label: t('sm.field.display_layout'), type: 'enum', default: 'list', options: [
          { value: 'list', label: t('sm.layout.list') },
          { value: 'grid', label: t('sm.layout.grid') },
          { value: 'split', label: t('sm.layout.split') },
          { value: 'counter', label: t('sm.layout.counter') },
        ]},
        { key: 'display_refresh_interval', label: t('sm.field.refresh_interval'), type: 'num', default: 5, min: 1 },
        { key: 'announcement_sound_enabled', label: t('sm.field.announcement_sound'), type: 'bool', default: true },
        { key: 'voice_announcements', label: t('sm.field.voice_announcements'), type: 'bool', default: false },
        { key: 'show_ads', label: t('sm.field.show_ads'), type: 'bool', default: false },
        { key: 'kiosk_welcome_message', label: t('sm.field.kiosk_welcome'), type: 'text', default: '' },
        { key: 'kiosk_header_text', label: t('sm.field.kiosk_header'), type: 'text', default: '' },
        { key: 'kiosk_button_label', label: t('sm.field.kiosk_button'), type: 'text', default: '' },
        { key: 'kiosk_theme_color', label: t('sm.field.kiosk_theme'), type: 'text', default: '', placeholder: '#3b82f6' },
        { key: 'kiosk_language', label: t('sm.field.kiosk_language'), type: 'enum', default: 'en', options: [
          { value: 'en', label: t('sm.lang.en') },
          { value: 'fr', label: t('sm.lang.fr') },
          { value: 'ar', label: t('sm.lang.ar') },
        ]},
        { key: 'kiosk_idle_timeout', label: t('sm.field.kiosk_idle'), type: 'num', default: 60, min: 10 },
        { key: 'kiosk_show_estimated_time', label: t('sm.field.kiosk_show_eta'), type: 'bool', default: true },
        { key: 'kiosk_show_priorities', label: t('sm.field.kiosk_show_priorities'), type: 'bool', default: false },
      ],
    },
    {
      id: 'languages',
      icon: '🌐',
      title: t('sm.section.languages'),
      fields: [
        { key: 'default_language', label: t('sm.field.default_language'), type: 'enum', default: 'en', options: [
          { value: 'en', label: t('sm.lang.en') },
          { value: 'fr', label: t('sm.lang.fr') },
          { value: 'ar', label: t('sm.lang.ar') },
          { value: 'es', label: t('sm.lang.es') },
        ]},
        { key: 'supported_languages', label: t('sm.field.supported_languages'), type: 'multi', default: ['en'], options: [
          { value: 'en', label: t('sm.lang.en') },
          { value: 'fr', label: t('sm.lang.fr') },
          { value: 'ar', label: t('sm.lang.ar') },
          { value: 'es', label: t('sm.lang.es') },
        ]},
      ],
    },
    {
      id: 'advanced',
      icon: '⚙',
      title: t('sm.section.advanced'),
      fields: [
        { key: 'ticket_ttl_minutes', label: t('sm.field.ticket_ttl'), type: 'num', default: 0, min: 0, unlimitedWhenZero: true },
        { key: 'auto_recall_count', label: t('sm.field.auto_recall'), type: 'num', default: 0, min: 0 },
        { key: 'max_no_show_allowed', label: t('sm.field.max_no_show'), type: 'num', default: 3, min: 0 },
        { key: 'visit_intake_override_mode', label: t('sm.field.intake_override'), type: 'enum', default: 'business_hours', options: [
          { value: 'business_hours', label: t('sm.intake.hours') },
          { value: 'always_open', label: t('sm.intake.always') },
          { value: 'always_closed', label: t('sm.intake.never') },
        ]},
      ],
    },
  ], [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const allFieldKeys = useMemo(() => {
    const keys: string[] = [];
    sections.forEach(s => s.fields.forEach(f => keys.push(f.key)));
    return keys;
  }, [sections]);

  // ─── Resolve org id ───────────────────────────────────────────────
  const resolveOrgId = useCallback(async (): Promise<string> => {
    if (orgIdRef.current) return orgIdRef.current;
    await ensureAuth(storedAuth);
    const sb = await getSupabase();
    let orgId = organizationId;
    if (!orgId || orgId === 'undefined') {
      const { data: userData } = await sb.auth.getUser();
      const authUserId = userData?.user?.id;
      if (!authUserId) throw new Error('Not authenticated');
      const { data: staffRow, error: staffErr } = await sb
        .from('staff')
        .select('organization_id')
        .eq('auth_user_id', authUserId)
        .single();
      if (staffErr) throw staffErr;
      orgId = (staffRow as any)?.organization_id ?? '';
      if (!orgId) throw new Error('Could not resolve organization');
    }
    orgIdRef.current = orgId;
    return orgId;
  }, [organizationId, storedAuth]);

  // ─── Load ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      const [{ data, error: err }, officeResult] = await Promise.all([
        sb.from('organizations').select('name, settings').eq('id', orgId).single(),
        officeId
          ? sb.from('offices').select('timezone, operating_hours, settings').eq('id', officeId).single()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (err) { setError(err.message); return; }
      const s: SettingsShape = ((data as any)?.settings ?? {}) as SettingsShape;
      originalRef.current = { ...s };
      const name = ((data as any)?.name ?? '') as string;
      setOrgName(name);
      setOriginalOrgName(name);

      // Load office timezone + operating hours
      if (officeResult?.data) {
        const ofc = officeResult.data as any;
        const tz = ofc.timezone || 'Africa/Algiers';
        setOfficeTimezone(tz);
        setOriginalTimezone(tz);
        const oh = ofc.operating_hours as Record<string, { open: string; close: string } | null> | null;
        const sched: Record<string, DaySchedule> = {};
        for (const d of WEEK_DAYS) {
          const h = oh?.[d.key];
          if (!h || (h.open === '00:00' && h.close === '00:00')) {
            sched[d.key] = { open: '08:00', close: '17:00', closed: true };
          } else {
            sched[d.key] = { open: h.open, close: h.close, closed: false };
          }
        }
        setSchedule(sched);
        setOriginalSchedule(JSON.parse(JSON.stringify(sched)));
      }

      // Initialize values per field
      const init: Record<string, any> = {};
      sections.forEach(sec => {
        sec.fields.forEach(f => {
          if (f.key === 'booking_mode') {
            init[f.key] = (s.booking_mode ?? 'disabled') !== 'disabled';
            return;
          }
          const raw = s[f.key];
          switch (f.type) {
            case 'bool': init[f.key] = coerceBool(raw, f.default); break;
            case 'num': init[f.key] = raw == null ? f.default : coerceNum(raw, f.default); break;
            case 'text':
            case 'textarea':
            case 'enum': init[f.key] = coerceStr(raw, f.default); break;
            case 'multi': init[f.key] = coerceArr(raw, f.default); break;
          }
        });
      });
      setValues(init);
    } catch (e: any) {
      setError(e?.message ?? t('Failed to load settings'));
    } finally {
      setLoading(false);
    }
  }, [resolveOrgId, sections]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Open first section by default after load
  useEffect(() => {
    if (!loading && !error && Object.keys(openSections).length === 0) {
      setOpenSections({ [sections[0].id]: true });
    }
  }, [loading, error, sections, openSections]);

  // ─── Dirty tracking ───────────────────────────────────────────────
  const dirty = useMemo(() => {
    if (orgName !== originalOrgName) return true;
    if (officeTimezone !== originalTimezone) return true;
    if (JSON.stringify(schedule) !== JSON.stringify(originalSchedule)) return true;
    const o = originalRef.current;
    for (const key of allFieldKeys) {
      const cur = values[key];
      if (key === 'booking_mode') {
        const origEnabled = (o.booking_mode ?? 'disabled') !== 'disabled';
        if (cur !== origEnabled) return true;
        continue;
      }
      const orig = o[key];
      if (Array.isArray(cur)) {
        const origArr = Array.isArray(orig) ? orig : [];
        if (cur.length !== origArr.length || cur.some((v, i) => v !== origArr[i])) return true;
        continue;
      }
      if (orig == null && (cur === '' || cur === 0 || cur === false || (Array.isArray(cur) && cur.length === 0))) {
        // Treat "default" vs missing as equal only if the user didn't touch it — we can't know, so consider equal
        continue;
      }
      if (cur !== orig) return true;
    }
    return false;
  }, [values, allFieldKeys, orgName, originalOrgName]);

  // ─── Validation ───────────────────────────────────────────────────
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    sections.forEach(sec => sec.fields.forEach(f => {
      const v = values[f.key];
      if (f.type === 'num') {
        if (typeof v === 'number') {
          if (f.min != null && v < f.min) errs[f.key] = t('sm.err.min', { n: f.min });
          if (f.max != null && v > f.max) errs[f.key] = t('sm.err.max', { n: f.max });
        } else if (v != null && v !== '') {
          errs[f.key] = t('sm.err.invalid_number');
        }
      }
    }));
    if (!orgName.trim()) errs['__org_name'] = t('sm.err.required');
    return errs;
  }, [values, sections, orgName]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasErrors = Object.keys(errors).length > 0;

  // ─── Save ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (hasErrors) {
      setSaveError(t('sm.err.fix_errors'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      // Re-read to merge with freshest settings
      const { data: cur, error: readErr } = await sb
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .single();
      if (readErr) throw readErr;
      const current: SettingsShape = (((cur as any)?.settings ?? {}) as SettingsShape);
      const partial: SettingsShape = {};
      sections.forEach(sec => sec.fields.forEach(f => {
        const v = values[f.key];
        if (f.key === 'booking_mode') {
          partial.booking_mode = v ? 'simple' : 'disabled';
          return;
        }
        partial[f.key] = v;
      }));
      const merged = { ...current, ...partial };
      const updatePayload: any = { settings: merged };
      if (orgName !== originalOrgName) updatePayload.name = orgName;
      const { error: updErr } = await sb
        .from('organizations')
        .update(updatePayload)
        .eq('id', orgId);
      if (updErr) throw updErr;

      // Save office-level fields (timezone + operating hours)
      if (officeId) {
        const operatingHours: Record<string, { open: string; close: string }> = {};
        for (const d of WEEK_DAYS) {
          const day = schedule[d.key];
          operatingHours[d.key] = day.closed
            ? { open: '00:00', close: '00:00' }
            : { open: day.open, close: day.close };
        }
        const officeUpdate: any = {
          timezone: officeTimezone,
          operating_hours: operatingHours,
        };
        const { error: ofcErr } = await sb.from('offices').update(officeUpdate).eq('id', officeId);
        if (ofcErr) throw ofcErr;
      }

      // Sync visit_intake_override_mode to ALL offices (match web behavior)
      // The org setting is the source of truth; every office must have its copy
      // so the kiosk-server can read it from office.settings without needing the org
      if (merged.visit_intake_override_mode) {
        const { data: allOffices } = await sb
          .from('offices')
          .select('id, settings')
          .eq('organization_id', orgId);
        for (const ofc of allOffices ?? []) {
          const ofcSettings = ((ofc.settings as Record<string, any>) ?? {});
          if (ofcSettings.visit_intake_override_mode !== merged.visit_intake_override_mode) {
            await sb.from('offices').update({
              settings: { ...ofcSettings, visit_intake_override_mode: merged.visit_intake_override_mode },
            }).eq('id', ofc.id);
          }
        }
      }
      await load();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
      onSaved?.();
    } catch (e: any) {
      setSaveError(e?.message ?? t('Failed to save settings'));
    } finally {
      setSaving(false);
    }
  }

  // ─── Keyboard: Esc & Ctrl+S ───────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && !saving && !loading && !hasErrors) handleSave();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, loading, hasErrors]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Styles ───────────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg, #0f172a)',
    border: '1px solid var(--border, #475569)',
    borderRadius: 10,
    overflow: 'hidden',
    flexShrink: 0,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--text2, #94a3b8)',
    fontWeight: 600,
    display: 'block',
    marginBottom: 4,
  };
  const inputStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--border, #475569)',
    background: 'var(--surface, #1e293b)',
    color: 'var(--text, #f1f5f9)',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };
  const helpStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--text3, #64748b)',
    marginTop: 4,
  };
  const errStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--danger, #ef4444)',
    marginTop: 4,
  };

  const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 42, height: 24, borderRadius: 12, border: 'none', flexShrink: 0,
        background: on ? '#22c55e' : '#475569',
        position: 'relative', cursor: 'pointer', transition: 'background 0.15s',
        padding: 0,
      }}
      aria-pressed={on}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 20 : 2, width: 20, height: 20,
        borderRadius: 10, background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  );

  function renderField(f: FieldDef) {
    const v = values[f.key];
    const setV = (nv: any) => setValues(prev => ({ ...prev, [f.key]: nv }));
    const err = errors[f.key];
    const placeholder = f.unlimitedWhenZero ? t('Unlimited') : (f.placeholder ?? '');

    if (f.type === 'bool') {
      return (
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text, #f1f5f9)', fontWeight: 500 }}>{f.label}</div>
            {f.help && <div style={helpStyle}>{f.help}</div>}
          </div>
          <Toggle on={!!v} onChange={setV} />
        </div>
      );
    }
    if (f.type === 'textarea') {
      return (
        <div key={f.key} style={{ padding: '8px 0', gridColumn: '1 / -1' }}>
          <label style={labelStyle}>{f.label}</label>
          <textarea
            value={v ?? ''}
            onChange={(e) => setV(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
            placeholder={placeholder}
          />
          {f.help && <div style={helpStyle}>{f.help}</div>}
          {err && <div style={errStyle}>{err}</div>}
        </div>
      );
    }
    if (f.type === 'enum') {
      return (
        <div key={f.key} style={{ padding: '8px 0', gridColumn: '1 / -1' }}>
          <label style={labelStyle}>{f.label}</label>
          <select value={v ?? f.default} onChange={(e) => setV(e.target.value)} style={inputStyle}>
            {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {f.help && <div style={helpStyle}>{f.help}</div>}
        </div>
      );
    }
    if (f.type === 'multi') {
      const arr: string[] = Array.isArray(v) ? v : [];
      return (
        <div key={f.key} style={{ padding: '8px 0', gridColumn: '1 / -1' }}>
          <label style={labelStyle}>{f.label}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {f.options?.map(o => {
              const checked = arr.includes(o.value);
              return (
                <label key={o.value} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px', borderRadius: 8,
                  border: `1px solid ${checked ? 'var(--primary, #3b82f6)' : 'var(--border, #475569)'}`,
                  background: checked ? 'rgba(59,130,246,0.12)' : 'transparent',
                  cursor: 'pointer', fontSize: 12, color: 'var(--text, #f1f5f9)',
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked ? arr.filter(x => x !== o.value) : [...arr, o.value];
                      setV(next);
                    }}
                  />
                  {o.label}
                </label>
              );
            })}
          </div>
        </div>
      );
    }
    if (f.type === 'num') {
      return (
        <div key={f.key} style={{ padding: '8px 0' }}>
          <label style={labelStyle}>{f.label}</label>
          <input
            type="number"
            value={v ?? ''}
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            onChange={(e) => {
              const s = e.target.value;
              if (s === '') { setV(0); return; }
              const n = Number(s);
              setV(Number.isFinite(n) ? n : 0);
            }}
            style={inputStyle}
            placeholder={placeholder}
          />
          {f.help && <div style={helpStyle}>{f.help}</div>}
          {err && <div style={errStyle}>{err}</div>}
        </div>
      );
    }
    // text — full width by default since they're usually long values
    return (
      <div key={f.key} style={{ padding: '8px 0', gridColumn: '1 / -1' }}>
        <label style={labelStyle}>{f.label}</label>
        <input
          type="text"
          value={v ?? ''}
          onChange={(e) => setV(e.target.value)}
          style={inputStyle}
          placeholder={placeholder}
        />
        {f.help && <div style={helpStyle}>{f.help}</div>}
        {err && <div style={errStyle}>{err}</div>}
      </div>
    );
  }

  // ─── Filtered sections via search ─────────────────────────────────
  const q = search.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!q) return sections;
    return sections.map(sec => {
      const titleHit = sec.title.toLowerCase().includes(q);
      const fields = sec.fields.filter(f => titleHit || f.label.toLowerCase().includes(q));
      return { ...sec, fields };
    }).filter(sec => sec.fields.length > 0);
  }, [sections, q]);

  // Auto-open sections on search
  useEffect(() => {
    if (q) {
      const next: Record<string, boolean> = {};
      filteredSections.forEach(s => { next[s.id] = true; });
      setOpenSections(next);
    }
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection = (id: string) => setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)',
          width: 1000, maxWidth: '96vw', height: '88vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)',
          display: 'flex', alignItems: 'center', gap: 16,
          background: 'linear-gradient(180deg, rgba(100,116,139,0.10), transparent)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>
              ⚙ {t('Business Settings')}
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
              {officeName ? `${t('Office')}: ${officeName}` : t('sm.subtitle')}
            </p>
          </div>
          <input
            type="text"
            placeholder={t('sm.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 280 }}
          />
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
              width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text2, #94a3b8)', padding: 40 }}>{t('Loading...')}</p>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ color: 'var(--danger, #ef4444)', marginBottom: 12 }}>{error}</p>
              <button onClick={load} style={{
                background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>{t('Retry')}</button>
            </div>
          ) : (
            <>
              {/* Org name card — always visible */}
              <div style={{ ...cardStyle, padding: '12px 16px' }}>
                <label style={labelStyle}>{t('sm.field.org_name')}</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  style={inputStyle}
                />
                {errors['__org_name'] && <div style={errStyle}>{errors['__org_name']}</div>}
              </div>

              {/* Work Schedule & Timezone section */}
              {(!q || 'work schedule timezone hours'.includes(q)) && (
                <div style={cardStyle}>
                  <button
                    type="button"
                    onClick={() => toggleSection('schedule')}
                    style={{
                      width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                      padding: '14px 16px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10,
                      color: 'var(--text, #f1f5f9)',
                    }}
                  >
                    <span style={{ fontSize: 18 }}>🕐</span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{t('sm.section.schedule')}</span>
                    <span style={{ fontSize: 16, color: 'var(--text2, #94a3b8)', transform: openSections['schedule'] ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
                  </button>
                  {openSections['schedule'] && (
                    <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border, #475569)' }}>
                      {/* Timezone */}
                      <div style={{ padding: '10px 0' }}>
                        <label style={labelStyle}>{t('sm.field.timezone')}</label>
                        <select
                          value={officeTimezone}
                          onChange={(e) => setOfficeTimezone(e.target.value)}
                          style={inputStyle}
                        >
                          {TIMEZONES.map(tz => (
                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Always Open toggle — wired to visit_intake_override_mode org setting */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: 'var(--text, #f1f5f9)', fontWeight: 500 }}>{t('sm.field.always_open')}</div>
                          <div style={helpStyle}>{t('sm.help.always_open')}</div>
                        </div>
                        <Toggle
                          on={values.visit_intake_override_mode === 'always_open'}
                          onChange={(on) => setValues(prev => ({ ...prev, visit_intake_override_mode: on ? 'always_open' : 'business_hours' }))}
                        />
                      </div>

                      {/* Weekly schedule — hidden when always open */}
                      {values.visit_intake_override_mode !== 'always_open' && (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {WEEK_DAYS.map(day => {
                            const d = schedule[day.key];
                            return (
                              <div key={day.key} style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 10px', borderRadius: 8,
                                background: d.closed ? 'transparent' : 'rgba(34,197,94,0.06)',
                                border: `1px solid ${d.closed ? 'var(--border, #475569)' : '#22c55e33'}`,
                              }}>
                                <span style={{ width: 80, flexShrink: 0, fontSize: 11, fontWeight: 700, color: d.closed ? 'var(--text3, #64748b)' : 'var(--text, #f1f5f9)' }}>
                                  {t(`sm.day.${day.key}`)}
                                </span>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3, #64748b)', cursor: 'pointer', flexShrink: 0 }}>
                                  <input
                                    type="checkbox"
                                    checked={d.closed}
                                    onChange={() => setSchedule(prev => ({
                                      ...prev,
                                      [day.key]: { ...prev[day.key], closed: !prev[day.key].closed },
                                    }))}
                                  />
                                  {t('sm.closed')}
                                </label>
                                {!d.closed && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                                    <input
                                      type="time"
                                      value={d.open}
                                      onChange={(e) => setSchedule(prev => ({
                                        ...prev,
                                        [day.key]: { ...prev[day.key], open: e.target.value },
                                      }))}
                                      style={{ ...inputStyle, width: 100, padding: '4px 6px', fontSize: 12 }}
                                    />
                                    <span style={{ fontSize: 11, color: 'var(--text3, #64748b)' }}>→</span>
                                    <input
                                      type="time"
                                      value={d.close}
                                      onChange={(e) => setSchedule(prev => ({
                                        ...prev,
                                        [day.key]: { ...prev[day.key], close: e.target.value },
                                      }))}
                                      style={{ ...inputStyle, width: 100, padding: '4px 6px', fontSize: 12 }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {filteredSections.map(sec => {
                const open = !!openSections[sec.id];
                return (
                  <div key={sec.id} style={cardStyle}>
                    <button
                      type="button"
                      onClick={() => toggleSection(sec.id)}
                      style={{
                        width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                        padding: '14px 16px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10,
                        color: 'var(--text, #f1f5f9)',
                      }}
                    >
                      <span style={{ fontSize: 18 }}>{sec.icon}</span>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{sec.title}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3, #64748b)' }}>
                        {sec.fields.length} {t('sm.fields')}
                      </span>
                      <span style={{ fontSize: 16, color: 'var(--text2, #94a3b8)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
                    </button>
                    {open && (
                      <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border, #475569)' }}>
                        {sec.id === 'business' && (
                          <div style={helpStyle}>{t('sm.hours_note')}</div>
                        )}
                        {/* 2-column grid: short fields (num/bool) pair up,
                            long fields (text/textarea/enum/multi) span both
                            columns via gridColumn '1 / -1' set in renderField. */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                          columnGap: 20,
                          rowGap: 0,
                        }}>
                          {sec.fields.map(renderField)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredSections.length === 0 && q && (
                <p style={{ textAlign: 'center', color: 'var(--text3, #64748b)', padding: 30 }}>
                  {t('sm.no_results')}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border, #475569)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {saveError ? (
            <span style={{ color: 'var(--danger, #ef4444)', fontSize: 12, flex: 1 }}>{saveError}</span>
          ) : savedFlash ? (
            <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600, flex: 1 }}>✓ {t('Saved')}</span>
          ) : dirty ? (
            <span style={{ color: 'var(--warning, #f59e0b)', fontSize: 12, flex: 1 }}>● {t('sm.unsaved')}</span>
          ) : (
            <div style={{ flex: 1 }} />
          )}
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >{t('Cancel')}</button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving || loading || hasErrors}
            style={{
              background: !dirty || saving || loading || hasErrors ? 'var(--border, #475569)' : 'var(--primary, #3b82f6)',
              color: '#fff', border: 'none',
              padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: !dirty || saving || loading || hasErrors ? 'not-allowed' : 'pointer',
              opacity: !dirty || saving || loading || hasErrors ? 0.6 : 1,
            }}
          >{saving ? t('Loading...') : t('Save changes')}</button>
        </div>
      </div>
    </div>
  );
}
