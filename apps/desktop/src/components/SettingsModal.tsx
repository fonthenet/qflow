import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { PrioritiesEditor } from './PrioritiesEditor';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import DatePicker from './DatePicker';
import TimePicker from './TimePicker';
import { ALGERIA_WILAYAS, getCommunes } from '../lib/algeria-wilayas';

// ── Intake Fields types (inlined from @qflo/shared) ─────────────
type IntakeFieldType = 'preset' | 'custom';
type IntakeFieldScope = 'both' | 'sameday' | 'booking';
interface IntakeField {
  key: string;
  type: IntakeFieldType;
  enabled: boolean;
  required: boolean;
  scope?: IntakeFieldScope;
  label?: string;
  label_fr?: string;
  label_ar?: string;
}
type PresetKey = 'name' | 'phone' | 'age' | 'wilaya' | 'reason';
const INTAKE_PRESETS: Record<PresetKey, { label: string; label_fr: string; label_ar: string }> = {
  name:   { label: 'Full name',        label_fr: 'Nom complet',         label_ar: '\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644' },
  phone:  { label: 'Phone number',     label_fr: 'Num\u00e9ro de t\u00e9l\u00e9phone', label_ar: '\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641' },
  age:    { label: 'Age',              label_fr: '\u00c2ge',             label_ar: '\u0627\u0644\u0639\u0645\u0631' },
  wilaya: { label: 'Wilaya',           label_fr: 'Wilaya',             label_ar: '\u0627\u0644\u0648\u0644\u0627\u064a\u0629' },
  reason: { label: 'Reason of visit',  label_fr: 'Motif de visite',    label_ar: '\u0633\u0628\u0628 \u0627\u0644\u0632\u064a\u0627\u0631\u0629' },
};
const PRESET_KEYS: PresetKey[] = ['name', 'phone', 'age', 'wilaya', 'reason'];

function getFieldLabel(field: IntakeField, locale: 'en' | 'fr' | 'ar'): string {
  if (field.type === 'preset') {
    const preset = INTAKE_PRESETS[field.key as PresetKey];
    if (preset) {
      if (locale === 'ar') return preset.label_ar;
      if (locale === 'fr') return preset.label_fr;
      return preset.label;
    }
  }
  if (locale === 'ar' && field.label_ar) return field.label_ar;
  if (locale === 'fr' && field.label_fr) return field.label_fr;
  return field.label || field.key;
}

function migrateToIntakeFields(settings: Record<string, any>): IntakeField[] {
  if (Array.isArray(settings.intake_fields) && settings.intake_fields.length > 0) {
    return settings.intake_fields;
  }
  // Fresh orgs (no legacy flag at all) default to name ON. Only orgs that
  // explicitly turned name off stay off.
  const hasLegacyRequireName = typeof settings.require_name_sameday === 'boolean';
  const requireName = hasLegacyRequireName ? settings.require_name_sameday : true;
  const customFields: { label: string; label_fr?: string; label_ar?: string }[] =
    Array.isArray(settings.custom_intake_fields) ? settings.custom_intake_fields : [];
  // Keep this in sync with packages/shared/src/intake-fields.ts —
  // name + phone are ON so every platform collects identity by default.
  // Channels that already know the customer exclude these via excludeKeys.
  const fields: IntakeField[] = [
    { key: 'name', type: 'preset', enabled: !!requireName, required: false },
    { key: 'phone', type: 'preset', enabled: true, required: false },
    { key: 'age', type: 'preset', enabled: false, required: false },
    { key: 'wilaya', type: 'preset', enabled: true, required: false },
    { key: 'reason', type: 'preset', enabled: true, required: false },
  ];
  for (const cf of customFields) {
    if (!cf.label?.trim()) continue;
    fields.push({
      key: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'custom',
      enabled: true,
      required: false,
      label: cf.label,
      label_fr: cf.label_fr || '',
      label_ar: cf.label_ar || '',
    });
  }
  return fields;
}

function generateCustomFieldKey(existing: IntakeField[]): string {
  const taken = new Set(existing.map(f => f.key));
  let n = 1;
  while (taken.has(`custom_${n}`)) n++;
  return `custom_${n}`;
}
// ── End Intake Fields types ─────────────────────────────────────

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

type FieldType = 'bool' | 'num' | 'text' | 'textarea' | 'enum' | 'multi' | 'horizon' | 'stepper' | 'color' | 'header';

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
  /** Extra fields not in `fields` but still need init/save (for merged sections with sub-tabs) */
  _allFields?: FieldDef[];
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
  const [activeSection, setActiveSection] = useState('booking');
  const [bookingSubTab, setBookingSubTab] = useState<'intake' | 'queue' | 'appointments' | 'priorities'>('intake');
  const [expandedIntakeField, setExpandedIntakeField] = useState<string | null>(null);
  const orgIdRef = useRef<string>('');
  const originalRef = useRef<SettingsShape>({});

  // Org-level non-settings fields
  const [orgName, setOrgName] = useState<string>('');
  const [originalOrgName, setOriginalOrgName] = useState<string>('');
  const [orgNameAr, setOrgNameAr] = useState<string>('');
  const [originalOrgNameAr, setOriginalOrgNameAr] = useState<string>('');

  // Logo upload state (writes directly to Supabase via /api/upload-logo, no save-gated)
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  // Office-level: timezone + operating hours
  const [officeTimezone, setOfficeTimezone] = useState<string>('Africa/Algiers');
  const [originalTimezone, setOriginalTimezone] = useState<string>('Africa/Algiers');
  // Office-level: wilaya + city (Algerian province + commune)
  const [officeWilaya, setOfficeWilaya] = useState<string>('');
  const [originalWilaya, setOriginalWilaya] = useState<string>('');
  const [officeCity, setOfficeCity] = useState<string>('');
  const [originalCity, setOriginalCity] = useState<string>('');
  type DaySchedule = { open: string; close: string; closed: boolean; break_start?: string; break_end?: string };
  const defaultSchedule: Record<string, DaySchedule> = Object.fromEntries(
    WEEK_DAYS.map(d => [d.key, { open: '08:00', close: '17:00', closed: d.key === 'friday' || d.key === 'saturday' }]),
  );
  const [schedule, setSchedule] = useState<Record<string, DaySchedule>>(defaultSchedule);
  const [originalSchedule, setOriginalSchedule] = useState<Record<string, DaySchedule>>(defaultSchedule);
  // Snapshot of the weekly schedule taken right before the user flips "always
  // open" ON — so we can restore it if they flip it back OFF in the same
  // session, instead of losing their hours to default/zero values.
  const scheduleBeforeAlwaysOpenRef = useRef<Record<string, DaySchedule> | null>(null);

  // Holidays
  type Holiday = { id?: string; holiday_date: string; name: string; is_full_day: boolean; open_time?: string; close_time?: string };
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [originalHolidays, setOriginalHolidays] = useState<Holiday[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [copyFromDay, setCopyFromDay] = useState<string | null>(null);

  // All settings values stored in a single map (string->any)
  const [values, setValues] = useState<Record<string, any>>({});

  // ── WhatsApp / Arabic code availability (real-time, debounced) ──
  // Mirrors the web portal's `checkWhatsAppCodeAvailability`: on every change
  // to either code we wait 500 ms then query Supabase's `organizations` table
  // and check that no *other* org already uses the code as either its
  // whatsapp_code or arabic_code.
  type Availability = 'idle' | 'checking' | 'available' | 'taken';
  const [waCodeAvailability, setWaCodeAvailability] = useState<Availability>('idle');
  const [arCodeAvailability, setArCodeAvailability] = useState<Availability>('idle');
  const waCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedWaCodeRef = useRef<string>('');
  const savedArCodeRef = useRef<string>('');

  const runCodeAvailability = useCallback(
    async (code: string, field: 'whatsapp_code' | 'arabic_code'): Promise<Availability> => {
      const normalized = field === 'whatsapp_code' ? code.toUpperCase().trim() : code.trim();
      if (!normalized || normalized.length < 2) return 'idle';
      try {
        const sb = await getSupabase();
        const orgId = orgIdRef.current;
        const { data: otherOrgs } = await sb
          .from('organizations')
          .select('id, settings')
          .neq('id', orgId);
        const taken = (otherOrgs ?? []).some((o: any) => {
          const s = ((o?.settings) ?? {}) as Record<string, any>;
          const otherWa = (s.whatsapp_code ?? '').toString().toUpperCase().trim();
          const otherAr = (s.arabic_code ?? '').toString().trim();
          if (field === 'whatsapp_code') {
            return normalized === otherWa || normalized === otherAr.toUpperCase();
          }
          return normalized === otherAr || normalized.toUpperCase() === otherWa;
        });
        return taken ? 'taken' : 'available';
      } catch {
        // Offline or query failure — show idle so the user isn't blocked.
        return 'idle';
      }
    },
    [],
  );

  useEffect(() => {
    const raw = (values.whatsapp_code ?? '').toString();
    const normalized = raw.toUpperCase().trim();
    if (!normalized || normalized.length < 2 || normalized === savedWaCodeRef.current.toUpperCase().trim()) {
      setWaCodeAvailability('idle');
      return;
    }
    setWaCodeAvailability('checking');
    if (waCheckTimerRef.current) clearTimeout(waCheckTimerRef.current);
    waCheckTimerRef.current = setTimeout(async () => {
      const result = await runCodeAvailability(raw, 'whatsapp_code');
      setWaCodeAvailability(result);
    }, 500);
    return () => { if (waCheckTimerRef.current) clearTimeout(waCheckTimerRef.current); };
  }, [values.whatsapp_code, runCodeAvailability]);

  useEffect(() => {
    const raw = (values.arabic_code ?? '').toString();
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length < 2 || trimmed === savedArCodeRef.current.trim()) {
      setArCodeAvailability('idle');
      return;
    }
    setArCodeAvailability('checking');
    if (arCheckTimerRef.current) clearTimeout(arCheckTimerRef.current);
    arCheckTimerRef.current = setTimeout(async () => {
      const result = await runCodeAvailability(raw, 'arabic_code');
      setArCodeAvailability(result);
    }, 500);
    return () => { if (arCheckTimerRef.current) clearTimeout(arCheckTimerRef.current); };
  }, [values.arabic_code, runCodeAvailability]);

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
      title: t('Booking & Queue'),
      fields: [], // Custom-rendered with sub-tabs
      // All booking + ticketing fields defined here for settings key extraction
      _allFields: [
        // Appointments sub-tab
        { key: 'booking_mode', label: t('sm.field.booking_enabled'), type: 'bool', default: true },
        { key: 'slot_duration_minutes', label: t('sm.field.slot_duration'), type: 'stepper', default: 30, min: 5, max: 120, step: 5 },
        { key: 'slots_per_interval', label: t('sm.field.slots_per_interval'), type: 'num', default: 1, min: 1 },
        { key: 'daily_ticket_limit', label: t('sm.field.daily_limit'), type: 'num', default: 0, min: 0, unlimitedWhenZero: true },
        { key: 'booking_horizon_days', label: t('sm.field.horizon_days'), type: 'horizon', default: 90, min: 1, max: 365, presets: [7, 15, 30, 60, 90] },
        { key: 'min_booking_lead_hours', label: t('sm.field.lead_hours'), type: 'num', default: 1, min: 0 },
        { key: 'allow_cancellation', label: t('sm.field.allow_cancel'), type: 'bool', default: true },
        { key: 'require_appointment_approval', label: t('sm.field.require_appointment_approval'), type: 'bool', default: true, help: t('sm.help.require_appointment_approval') },
        // Queue sub-tab
        { key: 'ticket_number_prefix', label: t('sm.field.ticket_prefix'), type: 'text', default: '', placeholder: 'TK-', help: t('sm.help.ticket_prefix') },
        { key: 'ticket_number_format', label: t('sm.field.ticket_format'), type: 'enum', default: 'dept_numeric', options: [
          { value: 'dept_numeric', label: t('sm.fmt.dept_numeric') },
          { value: 'prefix_numeric', label: t('sm.fmt.prefix_numeric') },
          { value: 'prefix_dept_numeric', label: t('sm.fmt.prefix_dept_numeric') },
        ]},
        // Check-in mode — must match the web admin's options. The server
        // (apps/web/src/app/api/kiosk-ticket/route.ts) blocks self-service
        // kiosk ticket creation when this is 'manual', so the enum values
        // here have to match exactly or settings round-trips lose fidelity.
        { key: 'default_check_in_mode', label: t('sm.field.check_in_mode'), type: 'enum', default: 'hybrid', options: [
          { value: 'self_service', label: t('sm.checkin.self_service') },
          { value: 'manual', label: t('sm.checkin.manual') },
          { value: 'hybrid', label: t('sm.checkin.hybrid') },
        ], help: t('sm.help.check_in_mode') },
        { key: 'auto_no_show_timeout', label: t('sm.field.auto_no_show'), type: 'num', default: 1, min: 0, help: t('sm.help.auto_no_show') },
        { key: 'max_queue_size', label: t('sm.field.max_queue'), type: 'num', default: 50, min: 0, unlimitedWhenZero: true, help: t('sm.help.max_queue') },
        { key: 'require_ticket_approval', label: t('sm.field.require_ticket_approval'), type: 'bool', default: false, help: t('sm.help.require_ticket_approval') },
      ],
    },
    {
      id: 'channels',
      icon: '📱',
      title: t('sm.section.channels'),
      fields: [], // Custom-rendered section
    },
    {
      id: 'notifications',
      icon: '🔔',
      title: t('sm.section.notifications'),
      fields: [
        { key: 'priority_alerts_sms_enabled', label: t('sm.field.priority_alerts'), type: 'bool', default: false, help: t('sm.help.priority_alerts') },
        { key: 'priority_alerts_sms_on_call', label: t('sm.field.alert_on_call'), type: 'bool', default: true },
        { key: 'priority_alerts_sms_on_recall', label: t('sm.field.alert_on_recall'), type: 'bool', default: true },
        { key: 'priority_alerts_sms_on_buzz', label: t('sm.field.alert_on_buzz'), type: 'bool', default: true },
      ],
    },
    {
      id: 'display',
      icon: '🖥',
      title: t('sm.section.display'),
      fields: [
        // ── Kiosk flow ───────────────────────────────────────────────
        { key: '__hdr_kiosk_flow', label: t('sm.hdr.kiosk_flow'), type: 'header', default: null, help: t('sm.hdr.kiosk_flow_help') },
        { key: 'kiosk_mode', label: t('sm.field.kiosk_mode'), type: 'enum', default: 'normal', options: [
          { value: 'normal', label: t('sm.kiosk_mode.normal') },
          { value: 'quick_book', label: t('sm.kiosk_mode.quick_book') },
        ], help: t('sm.help.kiosk_mode') },
        { key: 'kiosk_idle_timeout', label: t('sm.field.kiosk_idle'), type: 'num', default: 60, min: 10, help: t('sm.help.kiosk_idle') },
        { key: 'kiosk_show_estimated_time', label: t('sm.field.kiosk_show_eta'), type: 'bool', default: true },
        { key: 'kiosk_show_priorities', label: t('sm.field.kiosk_show_priorities'), type: 'bool', default: false },

        // ── Kiosk copy & branding ───────────────────────────────────
        { key: '__hdr_kiosk_brand', label: t('sm.hdr.kiosk_brand'), type: 'header', default: null },
        { key: 'kiosk_welcome_message', label: t('sm.field.kiosk_welcome'), type: 'text', default: '', placeholder: t('sm.ph.kiosk_welcome') },
        { key: 'kiosk_header_text', label: t('sm.field.kiosk_header'), type: 'text', default: '', placeholder: t('sm.ph.kiosk_header') },
        { key: 'kiosk_button_label', label: t('sm.field.kiosk_button'), type: 'text', default: '', placeholder: t('sm.ph.kiosk_button') },
        { key: 'kiosk_theme_color', label: t('sm.field.kiosk_theme'), type: 'color', default: '#3b82f6', placeholder: '#3b82f6', help: t('sm.help.kiosk_theme') },
        { key: 'kiosk_show_logo', label: t('sm.field.kiosk_show_logo'), type: 'bool', default: true, help: t('sm.help.kiosk_show_logo') },
        { key: 'kiosk_logo_url', label: t('sm.field.kiosk_logo_url'), type: 'text', default: '', placeholder: 'https://…/logo.png', help: t('sm.help.kiosk_logo_url') },

        // ── Sound & announcements ───────────────────────────────────
        { key: '__hdr_sound', label: t('sm.hdr.sound'), type: 'header', default: null },
        { key: 'announcement_sound_enabled', label: t('sm.field.announcement_sound'), type: 'bool', default: true, help: t('sm.help.announcement_sound') },
        { key: 'voice_announcements', label: t('sm.field.voice_announcements'), type: 'bool', default: false, help: t('sm.help.voice_announcements') },
      ],
    },
    {
      id: 'languages',
      icon: '🌐',
      title: t('sm.section.languages'),
      fields: [], // Station language handled as custom section below
    },
    {
      id: 'account',
      icon: '👤',
      title: t('Account'),
      fields: [], // Custom-rendered section
    },
  ], [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Account section state ──
  const [acctEmail, setAcctEmail] = useState('');
  const [acctNewPassword, setAcctNewPassword] = useState('');
  const [acctConfirmPassword, setAcctConfirmPassword] = useState('');
  const [acctEmailBusy, setAcctEmailBusy] = useState(false);
  const [acctPwdBusy, setAcctPwdBusy] = useState(false);
  const [acctEmailMsg, setAcctEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [acctPwdMsg, setAcctPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Load current email on mount
  useEffect(() => {
    (async () => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        const { data } = await sb.auth.getUser();
        if (data?.user?.email) setAcctEmail(data.user.email);
      } catch {}
    })();
  }, []);

  const handleUpdateEmail = async () => {
    if (!acctEmail.trim() || acctEmailBusy) return;
    setAcctEmailBusy(true);
    setAcctEmailMsg(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error } = await sb.auth.updateUser({ email: acctEmail.trim() });
      if (error) throw error;
      setAcctEmailMsg({ ok: true, text: t('Email updated successfully') });
    } catch (err: any) {
      setAcctEmailMsg({ ok: false, text: err?.message || t('Failed to update email') });
    } finally {
      setAcctEmailBusy(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!acctNewPassword || acctPwdBusy) return;
    if (acctNewPassword.length < 6) {
      setAcctPwdMsg({ ok: false, text: t('Password must be at least 6 characters') });
      return;
    }
    if (acctNewPassword !== acctConfirmPassword) {
      setAcctPwdMsg({ ok: false, text: t('Passwords do not match') });
      return;
    }
    setAcctPwdBusy(true);
    setAcctPwdMsg(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error } = await sb.auth.updateUser({ password: acctNewPassword });
      if (error) throw error;
      setAcctNewPassword('');
      setAcctConfirmPassword('');
      setAcctPwdMsg({ ok: true, text: t('Password updated successfully') });
    } catch (err: any) {
      setAcctPwdMsg({ ok: false, text: err?.message || t('Failed to update password') });
    } finally {
      setAcctPwdBusy(false);
    }
  };

  // Side nav items: sections + schedule
  const navItems = useMemo(() => {
    const items: { id: string; icon: string; title: string }[] = [];
    for (const sec of sections) {
      items.push({ id: sec.id, icon: sec.icon, title: sec.title });
      // Insert schedule after business
      if (sec.id === 'business') {
        items.push({ id: 'schedule', icon: '🕐', title: t('sm.section.schedule') });
      }
    }
    return items;
  }, [sections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys managed by custom-rendered sections (not in fields arrays)
  const CUSTOM_KEYS = ['whatsapp_enabled','whatsapp_code','arabic_code',
    'messenger_enabled','messenger_code','messenger_page_id',
    'web_enabled','kiosk_enabled','qr_code_enabled','virtual_queue_enabled',
    'visit_intake_override_mode','intake_fields'];

  const allFieldKeys = useMemo(() => {
    const keys: string[] = [];
    sections.forEach(s => {
      s.fields.forEach(f => { if (f.type !== 'header') keys.push(f.key); });
      s._allFields?.forEach(f => { if (f.type !== 'header') keys.push(f.key); });
    });
    // Channel keys are custom-rendered (not in fields array) but must be tracked
    keys.push(...CUSTOM_KEYS);
    return keys;
  }, [sections]);

  // ─── Resolve org id ───────────────────────────────────────────────
  const resolveOrgId = useCallback(async (): Promise<string> => {
    if (orgIdRef.current) return orgIdRef.current;
    await ensureAuth();
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
      const [{ data, error: err }, officeResult, holidayResult] = await Promise.all([
        sb.from('organizations').select('name, name_ar, settings, timezone, logo_url').eq('id', orgId).single(),
        officeId
          ? sb.from('offices').select('operating_hours, settings, wilaya, city').eq('id', officeId).single()
          : Promise.resolve({ data: null, error: null }),
        officeId
          ? sb.from('office_holidays').select('*').eq('office_id', officeId).order('holiday_date', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (err) { setError(err.message); return; }
      const s: SettingsShape = ((data as any)?.settings ?? {}) as SettingsShape;
      originalRef.current = { ...s };
      const name = ((data as any)?.name ?? '') as string;
      setOrgName(name);
      setOriginalOrgName(name);
      const nameAr = ((data as any)?.name_ar ?? '') as string;
      setOrgNameAr(nameAr);
      setOriginalOrgNameAr(nameAr);
      setLogoUrl(((data as any)?.logo_url ?? null) as string | null);

      // Load org-level timezone (single source of truth for the business)
      const orgTz = (data as any)?.timezone || 'Africa/Algiers';
      setOfficeTimezone(orgTz);
      setOriginalTimezone(orgTz);

      // Load office operating hours
      if (officeResult?.data) {
        const ofc = officeResult.data as any;
        const wilaya = typeof ofc.wilaya === 'string' ? ofc.wilaya : '';
        const city = typeof ofc.city === 'string' ? ofc.city : '';
        setOfficeWilaya(wilaya);
        setOriginalWilaya(wilaya);
        setOfficeCity(city);
        setOriginalCity(city);
        const oh = ofc.operating_hours as Record<string, { open: string; close: string; break_start?: string; break_end?: string } | null> | null;
        const sched: Record<string, DaySchedule> = {};
        for (const d of WEEK_DAYS) {
          const h = oh?.[d.key];
          if (!h || (h.open === '00:00' && h.close === '00:00')) {
            sched[d.key] = { open: '08:00', close: '17:00', closed: true };
          } else {
            sched[d.key] = { open: h.open, close: h.close, closed: false, break_start: h.break_start || '', break_end: h.break_end || '' };
          }
        }
        setSchedule(sched);
        setOriginalSchedule(JSON.parse(JSON.stringify(sched)));
      }

      // Load holidays
      if (holidayResult?.data) {
        const hols: Holiday[] = (holidayResult.data as any[]).map((h: any) => ({
          id: h.id,
          holiday_date: h.holiday_date,
          name: h.name || '',
          is_full_day: h.is_full_day !== false,
          open_time: h.open_time || '',
          close_time: h.close_time || '',
        }));
        setHolidays(hols);
        setOriginalHolidays(JSON.parse(JSON.stringify(hols)));
      }

      // Initialize values per field
      const init: Record<string, any> = {};
      sections.forEach(sec => {
        const allFields = [...sec.fields, ...(sec._allFields ?? [])];
        allFields.forEach(f => {
          if (f.key === 'booking_mode') {
            init[f.key] = (s.booking_mode ?? 'simple') !== 'disabled';
            return;
          }
          const raw = s[f.key];
          switch (f.type) {
            case 'bool': init[f.key] = coerceBool(raw, f.default); break;
            case 'num':
            case 'horizon': init[f.key] = raw == null ? f.default : coerceNum(raw, f.default); break;
            case 'text':
            case 'textarea':
            case 'color':
            case 'enum': init[f.key] = coerceStr(raw, f.default); break;
            case 'multi': init[f.key] = coerceArr(raw, f.default); break;
            case 'header': break;
          }
        });
      });
      // Custom-rendered fields (not in fields arrays)
      const channelKeys = CUSTOM_KEYS;
      for (const ck of channelKeys) {
        if (ck === 'intake_fields') continue; // handled below via migrateToIntakeFields
        if (ck.endsWith('_enabled')) {
          init[ck] = coerceBool(s[ck], ck === 'web_enabled' ? true : false);
        } else if (ck === 'visit_intake_override_mode') {
          init[ck] = coerceStr(s[ck], 'business_hours');
        } else {
          init[ck] = coerceStr(s[ck], '');
        }
      }

      // Unified intake fields (migrates from legacy require_name_sameday + custom_intake_fields)
      init.intake_fields = migrateToIntakeFields(s);

      setValues(init);
      // Snapshot the saved codes so live availability checks can skip the
      // already-persisted value (no point flagging your own code as taken).
      savedWaCodeRef.current = (init.whatsapp_code ?? '').toString();
      savedArCodeRef.current = (init.arabic_code ?? '').toString();
    } catch (e: any) {
      setError(e?.message ?? t('Failed to load settings'));
    } finally {
      setLoading(false);
    }
  }, [resolveOrgId, sections]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // After load, ensure activeSection is valid
  useEffect(() => {
    if (!loading && !error && sections.length > 0 && !sections.find(s => s.id === activeSection) && activeSection !== 'schedule') {
      setActiveSection(sections[0].id);
    }
  }, [loading, error, sections, activeSection]);

  // ─── Dirty tracking ───────────────────────────────────────────────
  const dirty = useMemo(() => {
    if (orgName !== originalOrgName) return true;
    if (orgNameAr !== originalOrgNameAr) return true;
    if (officeTimezone !== originalTimezone) return true;
    if (officeWilaya !== originalWilaya) return true;
    if (officeCity !== originalCity) return true;
    if (JSON.stringify(schedule) !== JSON.stringify(originalSchedule)) return true;
    if (JSON.stringify(holidays) !== JSON.stringify(originalHolidays)) return true;
    const o = originalRef.current;
    for (const key of allFieldKeys) {
      const cur = values[key];
      if (key === 'booking_mode') {
        const origEnabled = (o.booking_mode ?? 'simple') !== 'disabled';
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
  }, [values, allFieldKeys, orgName, originalOrgName, orgNameAr, originalOrgNameAr, officeTimezone, originalTimezone, officeWilaya, originalWilaya, officeCity, originalCity, schedule, originalSchedule, holidays, originalHolidays]);

  // ─── Validation ───────────────────────────────────────────────────
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    sections.forEach(sec => sec.fields.forEach(f => {
      const v = values[f.key];
      if (f.type === 'num' || f.type === 'horizon' || f.type === 'stepper') {
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

  // ─── Logo upload ──────────────────────────────────────────────────
  async function handleLogoFile(file: File | null | undefined) {
    if (!file) return;
    setLogoError(null);
    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      setLogoError(t('Invalid file type. Use PNG, JPG, WebP, or SVG.'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError(t('File too large (max 2MB)'));
      return;
    }
    setLogoUploading(true);
    try {
      const orgId = await resolveOrgId();
      const token = await ensureAuth();
      if (!token) throw new Error('Not authenticated');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('organizationId', orgId);
      const res = await fetch('https://qflo.net/api/upload-logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) throw new Error(data?.error || `Upload failed (${res.status})`);
      setLogoUrl(data.url);
      try { window.dispatchEvent(new CustomEvent('qflo:branding-updated')); } catch {}
    } catch (e: any) {
      setLogoError(e?.message ?? 'Upload failed');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  async function handleLogoRemove() {
    if (!logoUrl) return;
    setLogoError(null);
    setLogoUploading(true);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      const { error: updErr } = await sb.from('organizations').update({ logo_url: null }).eq('id', orgId);
      if (updErr) throw updErr;
      setLogoUrl(null);
      try { window.dispatchEvent(new CustomEvent('qflo:branding-updated')); } catch {}
    } catch (e: any) {
      setLogoError(e?.message ?? 'Failed to remove logo');
    } finally {
      setLogoUploading(false);
    }
  }

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
      sections.forEach(sec => {
        const allFields = [...sec.fields, ...(sec._allFields ?? [])];
        allFields.forEach(f => {
          if (f.type === 'header') return;
          const v = values[f.key];
          if (f.key === 'booking_mode') {
            partial.booking_mode = v ? 'simple' : 'disabled';
            return;
          }
          partial[f.key] = v;
        });
      });
      // Channel keys (custom-rendered, not in fields array)
      const channelKeys = CUSTOM_KEYS;
      for (const ck of channelKeys) { partial[ck] = values[ck]; }
      // Unified intake fields
      partial.intake_fields = values.intake_fields;
      // Remove legacy keys
      partial.require_name_sameday = undefined;
      partial.custom_intake_fields = undefined;
      // Messenger code always mirrors WhatsApp code
      partial.messenger_code = partial.whatsapp_code || '';

      // Uniqueness guard: WhatsApp code + Arabic code must not collide with
      // any other organization's whatsapp_code or arabic_code. Mirrors the
      // portal's `checkWhatsAppCodeAvailability` — belt-and-braces on the
      // Station side in case the admin edits codes here while offline and
      // another org claimed them in the meantime.
      const incomingWaCode = typeof partial.whatsapp_code === 'string'
        ? (partial.whatsapp_code as string).toUpperCase().trim()
        : '';
      const incomingArCode = typeof partial.arabic_code === 'string'
        ? (partial.arabic_code as string).trim()
        : '';
      if (incomingWaCode || incomingArCode) {
        try {
          const { data: otherOrgs } = await sb
            .from('organizations')
            .select('id, settings')
            .neq('id', orgId);
          for (const o of otherOrgs ?? []) {
            const s = (((o as any).settings) ?? {}) as Record<string, any>;
            const otherWa = (s.whatsapp_code ?? '').toString().toUpperCase().trim();
            const otherAr = (s.arabic_code ?? '').toString().trim();
            if (incomingWaCode && (incomingWaCode === otherWa || incomingWaCode === otherAr.toUpperCase())) {
              throw new Error(`${t('sm.field.whatsapp_code')} "${incomingWaCode}" — ${t('Already taken')}`);
            }
            if (incomingArCode && (incomingArCode === otherAr || incomingArCode.toUpperCase() === otherWa)) {
              throw new Error(`${t('sm.field.arabic_code')} "${incomingArCode}" — ${t('Already taken')}`);
            }
          }
        } catch (collisionErr: any) {
          // If the query itself fails (offline) we let the save proceed — the
          // server-side guard in web will still reject a collision when the
          // record syncs. Only abort if this is our own thrown uniqueness error.
          if (collisionErr && typeof collisionErr.message === 'string' && collisionErr.message.includes(t('Already taken'))) {
            throw collisionErr;
          }
        }
      }

      const merged = { ...current, ...partial };
      const updatePayload: any = { settings: merged };
      if (orgName !== originalOrgName) updatePayload.name = orgName;
      if (orgNameAr !== originalOrgNameAr) updatePayload.name_ar = orgNameAr || null;
      const { error: updErr } = await sb
        .from('organizations')
        .update(updatePayload)
        .eq('id', orgId);
      if (updErr) throw updErr;

      // Save office-level fields (timezone + operating hours)
      if (officeId) {
        // When "always open" is ON we intentionally preserve whatever
        // operating_hours are already in the DB — if the admin flips it back
        // OFF later, we want the real weekly schedule to still be there
        // instead of an all-zero calendar.
        const isAlwaysOpen = merged.visit_intake_override_mode === 'always_open';
        const officeUpdate: any = {};
        if (!isAlwaysOpen) {
          const operatingHours: Record<string, any> = {};
          for (const d of WEEK_DAYS) {
            const day = schedule[d.key];
            if (day.closed) {
              operatingHours[d.key] = { open: '00:00', close: '00:00' };
            } else {
              const entry: any = { open: day.open, close: day.close };
              if (day.break_start && day.break_end) {
                entry.break_start = day.break_start;
                entry.break_end = day.break_end;
              }
              operatingHours[d.key] = entry;
            }
          }
          officeUpdate.operating_hours = operatingHours;
        }
        if (officeWilaya !== originalWilaya) officeUpdate.wilaya = officeWilaya || null;
        if (officeCity !== originalCity) officeUpdate.city = officeCity || null;
        if (Object.keys(officeUpdate).length > 0) {
          const { error: ofcErr } = await sb.from('offices').update(officeUpdate).eq('id', officeId);
          if (ofcErr) throw ofcErr;
        }

        // Save timezone to org level (single source of truth)
        if (officeTimezone !== originalTimezone) {
          const { error: tzErr } = await sb.from('organizations').update({ timezone: officeTimezone }).eq('id', orgId);
          if (tzErr) throw tzErr;
        }

        // Save holidays — diff against original
        const origIds = new Set(originalHolidays.map(h => h.id).filter(Boolean));
        const curIds = new Set(holidays.map(h => h.id).filter(Boolean));
        // Delete removed
        for (const oid of origIds) {
          if (!curIds.has(oid)) {
            await sb.from('office_holidays').delete().eq('id', oid);
          }
        }
        // Insert new (no id)
        for (const h of holidays) {
          if (!h.id) {
            await sb.from('office_holidays').insert({
              office_id: officeId,
              holiday_date: h.holiday_date,
              name: h.name || null,
              is_full_day: h.is_full_day,
              open_time: h.is_full_day ? null : (h.open_time || null),
              close_time: h.is_full_day ? null : (h.close_time || null),
            });
          }
        }
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
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--text, #f1f5f9)', fontWeight: 500 }}>{f.label}</div>
            {f.help && <div style={helpStyle}>{f.help}</div>}
          </div>
          <Toggle on={!!v} onChange={setV} />
        </div>
      );
    }
    if (f.type === 'textarea') {
      return (
        <div key={f.key} style={{ padding: '5px 0', gridColumn: '1 / -1' }}>
          <label style={labelStyle}>{f.label}</label>
          <textarea
            value={v ?? ''}
            onChange={(e) => setV(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 48 }}
            placeholder={placeholder}
          />
          {f.help && <div style={helpStyle}>{f.help}</div>}
          {err && <div style={errStyle}>{err}</div>}
        </div>
      );
    }
    if (f.type === 'enum') {
      return (
        <div key={f.key} style={{ padding: '5px 0' }}>
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
        <div key={f.key} style={{ padding: '5px 0', gridColumn: '1 / -1' }}>
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
    if (f.type === 'horizon') {
      const presets = (f as any).presets ?? [7, 15, 30, 60, 90];
      const presetLabels: Record<number, string> = { 7: '1 sem.', 15: '15j', 30: '30j', 60: '60j', 90: '90j' };
      return (
        <div key={f.key} style={{ padding: '5px 0' }}>
          <label style={labelStyle}>{f.label}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            {presets.map((p: number) => (
              <button
                key={p}
                type="button"
                onClick={() => setV(p)}
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                  border: v === p ? '2px solid #3b82f6' : '1px solid #d1d5db',
                  background: v === p ? '#3b82f6' : '#fff',
                  color: v === p ? '#fff' : '#374151',
                  fontWeight: v === p ? 600 : 400,
                }}
              >
                {presetLabels[p] ?? `${p}j`}
              </button>
            ))}
            <input
              type="number"
              value={v ?? ''}
              min={f.min}
              max={f.max}
              onChange={(e) => {
                const s = e.target.value;
                if (s === '') { setV(0); return; }
                const n = Number(s);
                if (Number.isFinite(n) && n >= 1) setV(n);
              }}
              style={{ ...inputStyle, width: 70 }}
              placeholder={String(f.default)}
            />
            <span style={{ fontSize: 13, color: '#6b7280' }}>{t('sm.unit.days')}</span>
          </div>
          {err && <div style={errStyle}>{err}</div>}
        </div>
      );
    }
    if (f.type === 'stepper') {
      const stepSize = f.step ?? 5;
      const minVal = f.min ?? 5;
      const maxVal = f.max ?? 120;
      const numV = typeof v === 'number' ? v : (f.default ?? 30);
      const btnStyle: React.CSSProperties = {
        width: 32, height: 32, borderRadius: 8,
        border: '1px solid var(--border, #e2e8f0)',
        background: 'var(--surface2, #f1f5f9)',
        color: 'var(--text, #0f172a)',
        fontSize: 18, fontWeight: 700,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      };
      return (
        <div key={f.key} style={{ padding: '5px 0' }}>
          <label style={labelStyle}>{f.label}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              style={{ ...btnStyle, opacity: numV <= minVal ? 0.35 : 1 }}
              disabled={numV <= minVal}
              onClick={() => setV(Math.max(minVal, numV - stepSize))}
            >−</button>
            <span style={{ minWidth: 60, textAlign: 'center', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {numV} min
            </span>
            <button
              style={{ ...btnStyle, opacity: numV >= maxVal ? 0.35 : 1 }}
              disabled={numV >= maxVal}
              onClick={() => setV(Math.min(maxVal, numV + stepSize))}
            >+</button>
          </div>
          {f.help && <div style={helpStyle}>{f.help}</div>}
          {err && <div style={errStyle}>{err}</div>}
        </div>
      );
    }
    if (f.type === 'num') {
      return (
        <div key={f.key} style={{ padding: '5px 0' }}>
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
    if (f.type === 'header') {
      return (
        <div
          key={f.key}
          style={{
            gridColumn: '1 / -1',
            marginTop: 14,
            marginBottom: 2,
            paddingTop: 10,
            borderTop: '1px solid var(--border, #334155)',
          }}
        >
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--text3, #64748b)',
          }}>{f.label}</div>
          {f.help && <div style={{ ...helpStyle, marginTop: 2 }}>{f.help}</div>}
        </div>
      );
    }
    if (f.type === 'color') {
      const raw = typeof v === 'string' && v ? v : '';
      const valid = /^#[0-9a-fA-F]{6}$/.test(raw);
      const pickerValue = valid ? raw : (f.default || '#3b82f6');
      return (
        <div key={f.key} style={{ padding: '5px 0' }}>
          <label style={labelStyle}>{f.label}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={pickerValue}
              onChange={(e) => setV(e.target.value)}
              style={{
                width: 40, height: 34, padding: 2, borderRadius: 6,
                border: '1px solid var(--border, #475569)',
                background: 'transparent', cursor: 'pointer',
              }}
            />
            <input
              type="text"
              value={raw}
              onChange={(e) => setV(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
              placeholder={placeholder || '#3b82f6'}
            />
            {raw && (
              <button
                type="button"
                onClick={() => setV('')}
                style={{
                  padding: '6px 10px', fontSize: 12, borderRadius: 6,
                  border: '1px solid var(--border, #475569)',
                  background: 'transparent', color: 'var(--text2, #94a3b8)',
                  cursor: 'pointer',
                }}
              >{t('sm.color.reset')}</button>
            )}
          </div>
          {f.help && <div style={helpStyle}>{f.help}</div>}
          {err && <div style={errStyle}>{err}</div>}
        </div>
      );
    }
    // text — single column by default
    return (
      <div key={f.key} style={{ padding: '5px 0' }}>
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
      const allFieldsMatch = (sec._allFields ?? []).some(f => f.label.toLowerCase().includes(q));
      // Keep section if any field matches (in fields or _allFields)
      return { ...sec, fields, _hasMatch: fields.length > 0 || allFieldsMatch || titleHit };
    }).filter(sec => (sec as any)._hasMatch);
  }, [sections, q]);

  // Whether schedule section matches search
  const scheduleMatchesSearch = useMemo(() => {
    if (!q) return true;
    const scheduleTerms = ['work schedule', 'timezone', 'hours', 'schedule', t('sm.section.schedule').toLowerCase()];
    return scheduleTerms.some(term => term.includes(q));
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-switch to first matching section on search
  useEffect(() => {
    if (q) {
      // Determine first matching section id
      if (scheduleMatchesSearch && filteredSections.length === 0) {
        setActiveSection('schedule');
      } else if (filteredSections.length > 0) {
        setActiveSection(filteredSections[0].id);
      }
    }
  }, [q, filteredSections, scheduleMatchesSearch]);

  // ─── Render schedule content ──────────────────────────────────────
  function applyToOtherDays(srcKey: string, targetKeys: string[]) {
    const src = schedule[srcKey];
    setSchedule(prev => {
      const next = { ...prev };
      for (const k of targetKeys) {
        next[k] = { ...src };
      }
      return next;
    });
    setCopyFromDay(null);
  }

  function renderScheduleContent() {
    const weekdayKeys = WEEK_DAYS.slice(0, 5).map(d => d.key);
    const weekendKeys = WEEK_DAYS.slice(5).map(d => d.key);
    const allKeys = WEEK_DAYS.map(d => d.key);

    return (
      <div>
        {/* Timezone */}
        <div style={{ padding: '5px 0' }}>
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

        {/* Always Open toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--text, #f1f5f9)', fontWeight: 500 }}>{t('sm.field.always_open')}</div>
            <div style={helpStyle}>{t('sm.help.always_open')}</div>
          </div>
          <Toggle
            on={values.visit_intake_override_mode === 'always_open'}
            onChange={(on) => {
              if (on) {
                // Turning ON: snapshot the current weekly schedule so we can
                // put it back if the admin toggles OFF again.
                scheduleBeforeAlwaysOpenRef.current = JSON.parse(JSON.stringify(schedule));
              } else {
                // Turning OFF: restore the pre-always-open snapshot if we have
                // one, otherwise fall back to the last loaded schedule so the
                // admin never ends up with an all-zero / blanked-out calendar.
                const restored = scheduleBeforeAlwaysOpenRef.current ?? originalSchedule;
                setSchedule(JSON.parse(JSON.stringify(restored)));
              }
              setValues(prev => ({ ...prev, visit_intake_override_mode: on ? 'always_open' : 'business_hours' }));
            }}
          />
        </div>

        {/* Weekly schedule */}
        {values.visit_intake_override_mode !== 'always_open' && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {WEEK_DAYS.map(day => {
              const d = schedule[day.key];
              const hasBreak = !!(d.break_start && d.break_end);
              return (
                <div key={day.key} style={{
                  padding: '5px 10px', borderRadius: 8,
                  background: d.closed ? 'transparent' : 'rgba(34,197,94,0.06)',
                  border: `1px solid ${d.closed ? 'var(--border, #475569)' : '#22c55e33'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 75, flexShrink: 0, fontSize: 11, fontWeight: 700, color: d.closed ? 'var(--text3, #64748b)' : 'var(--text, #f1f5f9)' }}>
                      {t(`sm.day.${day.key}`)}
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text3, #64748b)', cursor: 'pointer', flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={d.closed}
                        onChange={() => setSchedule(prev => ({
                          ...prev,
                          [day.key]: { ...prev[day.key], closed: !prev[day.key].closed },
                        }))}
                        style={{ width: 13, height: 13 }}
                      />
                      {t('sm.closed')}
                    </label>
                    {!d.closed && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                          <TimePicker
                            value={d.open}
                            onChange={(e) => setSchedule(prev => ({
                              ...prev,
                              [day.key]: { ...prev[day.key], open: e.target.value },
                            }))}
                            step={15}
                            style={{ ...inputStyle, width: 95, padding: '3px 5px', fontSize: 11 }}
                          />
                          <span style={{ fontSize: 10, color: 'var(--text3, #64748b)' }}>→</span>
                          <TimePicker
                            value={d.close}
                            onChange={(e) => setSchedule(prev => ({
                              ...prev,
                              [day.key]: { ...prev[day.key], close: e.target.value },
                            }))}
                            step={15}
                            style={{ ...inputStyle, width: 95, padding: '3px 5px', fontSize: 11 }}
                          />
                        </div>
                        {/* Break toggle */}
                        <button
                          onClick={() => {
                            if (hasBreak) {
                              setSchedule(prev => ({ ...prev, [day.key]: { ...prev[day.key], break_start: '', break_end: '' } }));
                            } else {
                              setSchedule(prev => ({ ...prev, [day.key]: { ...prev[day.key], break_start: '12:00', break_end: '13:00' } }));
                            }
                          }}
                          title={hasBreak ? t('sm.remove_break') : t('sm.add_break')}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '0 2px',
                            color: hasBreak ? '#f59e0b' : 'var(--text3, #64748b)', opacity: hasBreak ? 1 : 0.6,
                          }}
                        >☕</button>
                        {/* Copy to... */}
                        <div style={{ position: 'relative' }} data-copy-menu>
                          <button
                            onClick={() => setCopyFromDay(copyFromDay === day.key ? null : day.key)}
                            title={t('sm.copy_hours')}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '0 2px',
                              color: 'var(--text3, #64748b)', opacity: 0.6,
                            }}
                          >📋</button>
                          {copyFromDay === day.key && (
                            <div style={{
                              position: 'absolute', right: 0, top: '100%', zIndex: 50,
                              background: 'var(--bg2, #1e293b)', border: '1px solid var(--border, #475569)',
                              borderRadius: 8, padding: 6, minWidth: 150, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                            }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3, #64748b)', marginBottom: 4, padding: '0 4px' }}>
                                {t('sm.apply_to')}
                              </div>
                              <button onClick={() => applyToOtherDays(day.key, allKeys.filter(k => k !== day.key))} style={copyBtnStyle}>
                                {t('sm.all_days')}
                              </button>
                              <button onClick={() => applyToOtherDays(day.key, weekdayKeys.filter(k => k !== day.key))} style={copyBtnStyle}>
                                {t('sm.weekdays')}
                              </button>
                              <button onClick={() => applyToOtherDays(day.key, weekendKeys.filter(k => k !== day.key))} style={copyBtnStyle}>
                                {t('sm.weekends')}
                              </button>
                              <div style={{ borderTop: '1px solid var(--border, #475569)', margin: '4px 0' }} />
                              {WEEK_DAYS.filter(wd => wd.key !== day.key).map(wd => (
                                <button key={wd.key} onClick={() => applyToOtherDays(day.key, [wd.key])} style={copyBtnStyle}>
                                  {t(`sm.day.${wd.key}`)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Break time row */}
                  {!d.closed && hasBreak && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 75 }}>
                      <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>☕ {t('sm.break')}</span>
                      <TimePicker
                        value={d.break_start || '12:00'}
                        onChange={(e) => setSchedule(prev => ({ ...prev, [day.key]: { ...prev[day.key], break_start: e.target.value } }))}
                        step={15}
                        style={{ ...inputStyle, width: 95, padding: '2px 5px', fontSize: 11 }}
                      />
                      <span style={{ fontSize: 10, color: 'var(--text3, #64748b)' }}>→</span>
                      <TimePicker
                        value={d.break_end || '13:00'}
                        onChange={(e) => setSchedule(prev => ({ ...prev, [day.key]: { ...prev[day.key], break_end: e.target.value } }))}
                        step={15}
                        style={{ ...inputStyle, width: 95, padding: '2px 5px', fontSize: 11 }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Holidays ─────────────────────────────────────────────── */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ ...labelStyle, margin: 0 }}>{t('sm.holidays')}</label>
            <span style={{ fontSize: 10, color: 'var(--text3, #64748b)' }}>{holidays.length} {holidays.length === 1 ? t('sm.holiday_count_one') : t('sm.holiday_count')}</span>
          </div>

          {/* Holiday list */}
          {holidays.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
              {holidays.map((h, i) => {
                const isPast = h.holiday_date < new Date().toISOString().slice(0, 10);
                return (
                  <div key={h.id || `new-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6,
                    background: isPast ? 'transparent' : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${isPast ? 'var(--border, #475569)' : 'rgba(239,68,68,0.2)'}`,
                    opacity: isPast ? 0.5 : 1,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text, #f1f5f9)', minWidth: 85 }}>
                      {h.holiday_date}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text2, #94a3b8)', flex: 1 }}>
                      {h.name || t('sm.holiday_unnamed')}
                    </span>
                    {!h.is_full_day && (
                      <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 500 }}>
                        {h.open_time} → {h.close_time}
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: h.is_full_day ? '#ef4444' : '#f59e0b', fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: h.is_full_day ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)' }}>
                      {h.is_full_day ? t('sm.full_day_off') : t('sm.reduced_hours')}
                    </span>
                    <button
                      onClick={() => setHolidays(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14, padding: '0 2px', opacity: 0.7 }}
                      title={t('sm.remove')}
                    >×</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add holiday form */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
            background: 'rgba(59,130,246,0.04)', border: '1px dashed rgba(59,130,246,0.2)',
          }}>
            <DatePicker
              value={newHolidayDate}
              onChange={(e) => setNewHolidayDate(e.target.value)}
              style={{ ...inputStyle, width: 130, padding: '3px 5px', fontSize: 11 }}
              min={new Date().toISOString().slice(0, 10)}
            />
            <input
              type="text"
              value={newHolidayName}
              onChange={(e) => setNewHolidayName(e.target.value)}
              placeholder={t('sm.holiday_name_placeholder')}
              style={{ ...inputStyle, flex: 1, padding: '3px 8px', fontSize: 11 }}
            />
            <button
              onClick={() => {
                if (!newHolidayDate) return;
                setHolidays(prev => [...prev, {
                  holiday_date: newHolidayDate,
                  name: newHolidayName,
                  is_full_day: true,
                }].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)));
                setNewHolidayDate('');
                setNewHolidayName('');
              }}
              disabled={!newHolidayDate}
              style={{
                background: newHolidayDate ? 'var(--primary, #3b82f6)' : 'var(--border, #475569)',
                color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11,
                fontWeight: 600, cursor: newHolidayDate ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
              }}
            >+ {t('sm.add_holiday')}</button>
          </div>
        </div>
      </div>
    );
  }

  const copyBtnStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left' as const,
    background: 'none', border: 'none', cursor: 'pointer', padding: '5px 8px',
    fontSize: 11, color: 'var(--text, #f1f5f9)', borderRadius: 4,
  };

  // Close copy dropdown on outside click
  useEffect(() => {
    if (!copyFromDay) return;
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('[data-copy-menu]');
      if (!el) setCopyFromDay(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [copyFromDay]);

  // ─── Render section content ───────────────────────────────────────
  function renderSectionContent(sec: SectionDef) {
    // Channels section — custom grouped layout
    if (sec.id === 'channels') {
      const channelGroupStyle: React.CSSProperties = {
        padding: '10px 12px', borderRadius: 10, marginBottom: 10,
        border: '1px solid var(--border, #475569)',
        background: 'rgba(255,255,255,0.02)',
      };
      const channelHeaderStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        marginBottom: 8,
      };
      const channelTitleStyle: React.CSSProperties = {
        fontSize: 13, fontWeight: 700, color: 'var(--text, #f1f5f9)',
        display: 'flex', alignItems: 'center', gap: 6,
      };
      const fieldRowStyle: React.CSSProperties = {
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        columnGap: 14, rowGap: 0,
      };
      const miniLabel: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--text2, #94a3b8)', marginBottom: 2 };
      const miniHelp: React.CSSProperties = { fontSize: 10, color: 'var(--text3, #64748b)', marginTop: 1, marginBottom: 4 };
      const miniInput: React.CSSProperties = { ...inputStyle, padding: '4px 8px', fontSize: 12 };

      return (
        <div>
          {/* ── WhatsApp ─────────────────── */}
          <div style={{
            ...channelGroupStyle,
            borderColor: values.whatsapp_enabled ? '#22c55e44' : 'var(--border, #475569)',
            background: values.whatsapp_enabled ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.02)',
          }}>
            <div style={channelHeaderStyle}>
              <div style={channelTitleStyle}>
                <span style={{ fontSize: 16 }}>💬</span> WhatsApp
              </div>
              <Toggle on={!!values.whatsapp_enabled} onChange={(on) => setValues(p => ({ ...p, whatsapp_enabled: on }))} />
            </div>
            {values.whatsapp_enabled && (() => {
              const renderStatus = (s: Availability, rtl?: boolean): JSX.Element | null => {
                if (s === 'idle') return null;
                const style: React.CSSProperties = {
                  position: 'absolute',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 11,
                  fontWeight: 600,
                  pointerEvents: 'none',
                };
                if (rtl) style.left = 10; else style.right = 10;
                if (s === 'checking') return <span style={{ ...style, color: '#9ca3af' }}>{t('sm.code.checking') || 'Checking…'}</span>;
                if (s === 'available') return <span style={{ ...style, color: '#22c55e' }}>✓ {t('sm.code.available') || 'Available'}</span>;
                return <span style={{ ...style, color: '#ef4444' }}>✗ {t('sm.code.taken') || 'Already taken'}</span>;
              };
              return (
                <div style={fieldRowStyle}>
                  <div>
                    <div style={miniLabel}>{t('sm.field.whatsapp_code')}</div>
                    <div style={{ position: 'relative' }}>
                      <input
                        value={values.whatsapp_code || ''}
                        onChange={e => setValues(p => ({ ...p, whatsapp_code: e.target.value.toUpperCase() }))}
                        placeholder="MYBUSINESS"
                        style={{
                          ...miniInput,
                          paddingRight: 92,
                          borderColor: waCodeAvailability === 'taken' ? '#ef4444' : (miniInput as any).borderColor,
                        }}
                      />
                      {renderStatus(waCodeAvailability, false)}
                    </div>
                    <div style={miniHelp}>{t('sm.help.whatsapp_code')}</div>
                  </div>
                  <div />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={miniLabel}>{t('sm.field.arabic_code')}</div>
                    <div style={{ position: 'relative', maxWidth: 220 }}>
                      <input
                        value={values.arabic_code || ''}
                        onChange={e => setValues(p => ({ ...p, arabic_code: e.target.value }))}
                        placeholder="اسم_النشاط"
                        style={{
                          ...miniInput,
                          direction: 'rtl',
                          textAlign: 'right',
                          paddingLeft: 92,
                          borderColor: arCodeAvailability === 'taken' ? '#ef4444' : (miniInput as any).borderColor,
                        }}
                      />
                      {renderStatus(arCodeAvailability, true)}
                    </div>
                    <div style={miniHelp}>{t('sm.help.arabic_code')}</div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── Messenger ────────────────── */}
          <div style={{
            ...channelGroupStyle,
            borderColor: values.messenger_enabled ? '#3b82f644' : 'var(--border, #475569)',
            background: values.messenger_enabled ? 'rgba(59,130,246,0.04)' : 'rgba(255,255,255,0.02)',
          }}>
            <div style={channelHeaderStyle}>
              <div style={channelTitleStyle}>
                <span style={{ fontSize: 16 }}>📘</span> Messenger
              </div>
              <Toggle on={!!values.messenger_enabled} onChange={(on) => setValues(p => ({ ...p, messenger_enabled: on }))} />
            </div>
            {false && values.messenger_enabled && (
              <div />
            )}
          </div>

          {/* ── Other channels ────────────── */}
          <div style={channelGroupStyle}>
            <div style={{ ...channelTitleStyle, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🌐</span> {t('sm.other_channels')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {([
                { key: 'web_enabled', label: t('sm.field.web_booking'), icon: '🔗' },
                { key: 'kiosk_enabled', label: t('sm.field.kiosk'), icon: '🖥' },
                { key: 'qr_code_enabled', label: t('sm.field.qr_code'), icon: '📱' },
                { key: 'virtual_queue_enabled', label: t('sm.field.virtual_queue'), icon: '📋' },
              ] as const).map(ch => (
                <div key={ch.key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '5px 8px', borderRadius: 6,
                  background: values[ch.key] ? 'rgba(34,197,94,0.04)' : 'transparent',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text, #f1f5f9)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>{ch.icon}</span> {ch.label}
                  </span>
                  <Toggle on={!!values[ch.key]} onChange={(on) => setValues(p => ({ ...p, [ch.key]: on }))} />
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Languages section — custom: controls Station locale (local setting, not org)
    if (sec.id === 'languages') {
      const langs: { value: string; label: string; flag: string }[] = [
        { value: 'fr', label: 'Français', flag: '🇫🇷' },
        { value: 'ar', label: 'العربية', flag: '🇩🇿' },
        { value: 'en', label: 'English', flag: '🇬🇧' },
      ];
      return (
        <div>
          <div style={{ ...labelStyle, marginBottom: 10 }}>{t('sm.field.station_language')}</div>
          <div style={helpStyle}>{t('sm.help.station_language')}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            {langs.map(l => {
              const active = locale === l.value;
              return (
                <button
                  key={l.value}
                  onClick={() => {
                    (window as any).qf?.settings?.setLocale?.(l.value);
                  }}
                  style={{
                    flex: 1, padding: '14px 12px', borderRadius: 10, cursor: 'pointer',
                    border: active ? '2px solid var(--primary, #3b82f6)' : '1px solid var(--border, #475569)',
                    background: active ? 'rgba(59,130,246,0.1)' : 'var(--surface, #1e293b)',
                    color: active ? 'var(--primary, #3b82f6)' : 'var(--text, #f1f5f9)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    fontWeight: active ? 700 : 500, fontSize: 14,
                  }}
                >
                  <span style={{ fontSize: 24 }}>{l.flag}</span>
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (sec.id === 'booking') {
      const intakeFields: IntakeField[] = values.intake_fields ?? [];
      const intakeLocale: 'en' | 'fr' | 'ar' = (locale === 'ar' ? 'ar' : locale === 'fr' ? 'fr' : 'en');
      const allFields = sec._allFields ?? [];
      // Split _allFields into queue fields and appointment fields by key
      const appointmentKeys = new Set(['booking_mode','slot_duration_minutes','slots_per_interval','daily_ticket_limit','booking_horizon_days','min_booking_lead_hours','allow_cancellation','require_appointment_approval']);
      const queueFields = allFields.filter(f => !appointmentKeys.has(f.key));
      const appointmentFields = allFields.filter(f => appointmentKeys.has(f.key));

      const subTabs: { id: 'intake' | 'queue' | 'appointments' | 'priorities'; label: string }[] = [
        { id: 'intake', label: t('Intake Fields') },
        { id: 'queue', label: t('Queue') },
        { id: 'appointments', label: t('Appointments') },
        { id: 'priorities', label: t('prio.tabLabel') },
      ];

      return (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border, #475569)', marginBottom: 16 }}>
            {subTabs.map(tab => {
              const active = bookingSubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setBookingSubTab(tab.id)}
                  style={{
                    padding: '8px 16px', fontSize: 13, fontWeight: active ? 700 : 500,
                    color: active ? 'var(--primary, #3b82f6)' : 'var(--text2, #94a3b8)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    borderBottom: active ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
                    marginBottom: -2,
                  }}
                >{tab.label}</button>
              );
            })}
          </div>

          {/* Intake sub-tab */}
          {bookingSubTab === 'intake' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>{t('sm.field.custom_intake_fields')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 2 }}>{t('sm.help.custom_intake_fields')}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newField: IntakeField = {
                      key: generateCustomFieldKey(intakeFields),
                      type: 'custom',
                      enabled: true,
                      required: false,
                      label: '',
                      label_fr: '',
                      label_ar: '',
                    };
                    setValues(prev => ({ ...prev, intake_fields: [...intakeFields, newField] }));
                  }}
                  style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border, #475569)', background: 'transparent', color: 'var(--text, #f1f5f9)', cursor: 'pointer' }}
                >
                  + {t('sm.custom_intake.add')}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {intakeFields.map((field, idx) => {
                  const isPreset = field.type === 'preset';
                  const displayLabel = isPreset
                    ? getFieldLabel(field, intakeLocale)
                    : (getFieldLabel(field, intakeLocale) || t('sm.custom_intake.untitled'));
                  const isFirst = idx === 0;
                  const isLast = idx === intakeFields.length - 1;
                  const isExpanded = !isPreset && (expandedIntakeField === field.key);
                  return (
                    <div key={field.key} style={{ borderRadius: 8, border: '1px solid var(--border, #475569)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
                      {/* Main row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}>
                        {/* Reorder buttons */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                          <button
                            type="button"
                            disabled={isFirst}
                            onClick={() => {
                              const updated = [...intakeFields];
                              [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
                              setValues(prev => ({ ...prev, intake_fields: updated }));
                            }}
                            style={{ fontSize: 10, lineHeight: 1, padding: '1px 4px', background: 'transparent', border: 'none', color: isFirst ? 'var(--text3, #64748b)' : 'var(--text2, #94a3b8)', cursor: isFirst ? 'default' : 'pointer', opacity: isFirst ? 0.4 : 1 }}
                            title="Move up"
                          >&#9650;</button>
                          <button
                            type="button"
                            disabled={isLast}
                            onClick={() => {
                              const updated = [...intakeFields];
                              [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
                              setValues(prev => ({ ...prev, intake_fields: updated }));
                            }}
                            style={{ fontSize: 10, lineHeight: 1, padding: '1px 4px', background: 'transparent', border: 'none', color: isLast ? 'var(--text3, #64748b)' : 'var(--text2, #94a3b8)', cursor: isLast ? 'default' : 'pointer', opacity: isLast ? 0.4 : 1 }}
                            title="Move down"
                          >&#9660;</button>
                        </div>

                        {/* Toggle switch */}
                        <label style={{ position: 'relative', display: 'inline-block', width: 32, height: 18, flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={!!field.enabled}
                            onChange={() => {
                              const updated = [...intakeFields];
                              updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled };
                              setValues(prev => ({ ...prev, intake_fields: updated }));
                            }}
                            style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                          />
                          <span style={{
                            position: 'absolute', cursor: 'pointer', inset: 0, borderRadius: 9,
                            background: field.enabled ? '#3b82f6' : 'var(--bg3, #334155)',
                            transition: 'background 0.2s',
                          }}>
                            <span style={{
                              position: 'absolute', left: field.enabled ? 16 : 2, top: 2,
                              width: 14, height: 14, borderRadius: '50%',
                              background: '#fff', transition: 'left 0.2s',
                            }} />
                          </span>
                        </label>

                        {/* Label */}
                        <span
                          style={{ flex: 1, fontSize: 13, fontWeight: 500, color: field.enabled ? 'var(--text, #f1f5f9)' : 'var(--text3, #64748b)', cursor: !isPreset ? 'pointer' : 'default' }}
                          onClick={() => { if (!isPreset) setExpandedIntakeField(isExpanded ? null : field.key); }}
                        >
                          {displayLabel}
                        </span>

                        {/* Badge */}
                        {isPreset && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontWeight: 600 }}>preset</span>
                        )}

                        {/* Required toggle */}
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...intakeFields];
                            updated[idx] = { ...updated[idx], required: !updated[idx].required };
                            setValues(prev => ({ ...prev, intake_fields: updated }));
                          }}
                          style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border, #475569)',
                            background: field.required ? 'rgba(245,158,11,0.15)' : 'transparent',
                            color: field.required ? '#fbbf24' : 'var(--text3, #64748b)',
                            cursor: 'pointer', fontWeight: 500,
                          }}
                        >
                          {field.required ? 'Required' : 'Optional'}
                        </button>

                        {/* Scope selector */}
                        <select
                          value={field.scope || 'both'}
                          onChange={(e) => {
                            const updated = [...intakeFields];
                            updated[idx] = { ...updated[idx], scope: e.target.value as IntakeFieldScope };
                            setValues(prev => ({ ...prev, intake_fields: updated }));
                          }}
                          style={{
                            fontSize: 10, padding: '1px 4px', borderRadius: 4,
                            border: '1px solid var(--border, #475569)',
                            background: 'var(--surface, #1e293b)',
                            color: (field.scope || 'both') === 'both' ? 'var(--text2, #94a3b8)' : '#60a5fa',
                            cursor: 'pointer', fontWeight: 500,
                          }}
                        >
                          <option value="both">{t('Both')}</option>
                          <option value="sameday">{t('Same-day')}</option>
                          <option value="booking">{t('Booking')}</option>
                        </select>

                        {/* Expand / Delete for custom fields */}
                        {!isPreset && (
                          <>
                            <button
                              type="button"
                              onClick={() => setExpandedIntakeField(isExpanded ? null : field.key)}
                              style={{ fontSize: 11, background: 'transparent', border: 'none', color: 'var(--text2, #94a3b8)', cursor: 'pointer', padding: '2px 4px' }}
                              title="Edit labels"
                            >{isExpanded ? '\u25B2' : '\u25BC'}</button>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = intakeFields.filter((_, i) => i !== idx);
                                setValues(prev => ({ ...prev, intake_fields: updated }));
                              }}
                              style={{ fontSize: 12, color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600, padding: '2px 4px' }}
                              title={t('sm.custom_intake.remove')}
                            >{'\u2715'}</button>
                          </>
                        )}
                      </div>

                      {/* Expandable label editor for custom fields */}
                      {isExpanded && !isPreset && (
                        <div style={{ padding: '6px 10px 10px 42px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, borderTop: '1px solid var(--border, #475569)', background: 'rgba(0,0,0,0.1)' }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2, #94a3b8)', marginBottom: 2 }}>{t('sm.custom_intake.label_en')}</div>
                            <input
                              value={field.label ?? ''}
                              onChange={(e) => {
                                const updated = [...intakeFields];
                                updated[idx] = { ...updated[idx], label: e.target.value };
                                setValues(prev => ({ ...prev, intake_fields: updated }));
                              }}
                              placeholder="e.g. Color"
                              style={{ width: '100%', padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border, #475569)', background: 'var(--bg2, #1e293b)', color: 'var(--text, #f1f5f9)' }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2, #94a3b8)', marginBottom: 2 }}>{t('sm.custom_intake.label_fr')}</div>
                            <input
                              value={field.label_fr ?? ''}
                              onChange={(e) => {
                                const updated = [...intakeFields];
                                updated[idx] = { ...updated[idx], label_fr: e.target.value };
                                setValues(prev => ({ ...prev, intake_fields: updated }));
                              }}
                              placeholder="ex. Couleur"
                              style={{ width: '100%', padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border, #475569)', background: 'var(--bg2, #1e293b)', color: 'var(--text, #f1f5f9)' }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2, #94a3b8)', marginBottom: 2 }}>{t('sm.custom_intake.label_ar')}</div>
                            <input
                              value={field.label_ar ?? ''}
                              onChange={(e) => {
                                const updated = [...intakeFields];
                                updated[idx] = { ...updated[idx], label_ar: e.target.value };
                                setValues(prev => ({ ...prev, intake_fields: updated }));
                              }}
                              placeholder={'\u0645\u062b\u0627\u0644: \u0627\u0644\u0644\u0648\u0646'}
                              dir="rtl"
                              style={{ width: '100%', padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border, #475569)', background: 'var(--bg2, #1e293b)', color: 'var(--text, #f1f5f9)' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Queue sub-tab */}
          {bookingSubTab === 'queue' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              columnGap: 20,
              rowGap: 0,
            }}>
              {queueFields.map(renderField)}
            </div>
          )}

          {/* Priorities sub-tab — mirrors /admin/priorities on the web portal. */}
          {bookingSubTab === 'priorities' && orgIdRef.current && (
            <PrioritiesEditor organizationId={orgIdRef.current} locale={locale as any} />
          )}

          {/* Appointments sub-tab */}
          {bookingSubTab === 'appointments' && (() => {
            const bookingOn = !!values.booking_mode;
            const slotDur: number = typeof values.slot_duration_minutes === 'number' ? values.slot_duration_minutes : 30;
            const horizon: number = typeof values.booking_horizon_days === 'number' ? values.booking_horizon_days : 90;
            const leadHrs: number = typeof values.min_booking_lead_hours === 'number' ? values.min_booking_lead_hours : 1;
            const perSlot: number = typeof values.slots_per_interval === 'number' ? values.slots_per_interval : 1;
            const dailyLim: number = typeof values.daily_ticket_limit === 'number' ? values.daily_ticket_limit : 0;
            const cancelOn: boolean = values.allow_cancellation !== false;
            const approvalOn: boolean = values.require_appointment_approval === undefined ? true : !!values.require_appointment_approval;
            const update = (k: string, v: any) => setValues(prev => ({ ...prev, [k]: v }));

            const cardStyle: React.CSSProperties = {
              background: 'var(--surface2, #334155)',
              border: '1px solid var(--border, #475569)',
              borderRadius: 10,
              padding: 14,
              display: 'flex', flexDirection: 'column', gap: 14,
            };
            const cardHeaderStyle: React.CSSProperties = {
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--text3, #64748b)',
            };
            const pillStyle = (active: boolean): React.CSSProperties => ({
              padding: '5px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
              border: `1px solid ${active ? 'var(--primary, #3b82f6)' : 'var(--border, #475569)'}`,
              background: active ? 'var(--primary, #3b82f6)' : 'var(--surface, #1e293b)',
              color: active ? '#fff' : 'var(--text, #f1f5f9)',
              fontWeight: active ? 600 : 500,
              transition: 'all 0.1s',
            });
            const numInputStyle: React.CSSProperties = { ...inputStyle, width: 74, padding: '6px 8px', fontSize: 12 };
            const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text3, #64748b)' };

            const PresetRow = ({ value, presets, min, max, unit, setter, labelFor }: {
              value: number; presets: { n: number; label: string }[];
              min: number; max: number; unit: string;
              setter: (n: number) => void; labelFor: string;
            }) => {
              const clampAndSet = (n: number) => setter(Math.max(min, Math.min(max, n)));
              const isCustom = !presets.some(p => p.n === value);
              return (
                <div>
                  <label style={labelStyle}>{labelFor}</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {presets.map(p => (
                      <button
                        key={p.n}
                        type="button"
                        onClick={() => clampAndSet(p.n)}
                        style={pillStyle(value === p.n)}
                      >{p.label}</button>
                    ))}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 4px 2px 8px', borderRadius: 999,
                      border: `1px solid ${isCustom ? 'var(--primary, #3b82f6)' : 'var(--border, #475569)'}`,
                      background: isCustom ? 'rgba(59,130,246,0.08)' : 'transparent',
                    }}>
                      <input
                        type="number"
                        value={value ?? ''}
                        min={min}
                        max={max}
                        onChange={(e) => {
                          const s = e.target.value;
                          if (s === '') { setter(min); return; }
                          const n = Number(s);
                          if (Number.isFinite(n)) clampAndSet(n);
                        }}
                        style={{ ...numInputStyle, width: 56, border: 'none', background: 'transparent', padding: '2px 0', textAlign: 'center' }}
                      />
                      <span style={unitStyle}>{unit}</span>
                    </div>
                  </div>
                </div>
              );
            };

            // Live summary — short, factual chips
            const summaryBits: string[] = [];
            summaryBits.push(`${slotDur} ${t('min')}`);
            summaryBits.push(`${perSlot}/${t('slot')}`);
            summaryBits.push(`${horizon} ${t('sm.unit.days')}`);
            if (leadHrs > 0) summaryBits.push(`≥ ${leadHrs}h ${t('lead')}`);
            if (dailyLim > 0) summaryBits.push(`${t('max')} ${dailyLim}/${t('day')}`);

            return (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 14,
                opacity: bookingOn ? 1 : 1, // always 1 so master toggle is clearly visible
              }}>
                {/* Master toggle card */}
                <div style={{
                  ...cardStyle,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  gap: 16, padding: 16,
                  borderColor: bookingOn ? '#22c55e66' : 'var(--border, #475569)',
                  background: bookingOn
                    ? 'linear-gradient(90deg, rgba(34,197,94,0.08), var(--surface2, #334155))'
                    : 'var(--surface2, #334155)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
                      {t('sm.field.booking_enabled')}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2, #94a3b8)', marginTop: 3 }}>
                      {t('Allow customers to book appointments via WhatsApp, Messenger, and the web portal')}
                    </div>
                  </div>
                  <Toggle on={bookingOn} onChange={(v) => update('booking_mode', v)} />
                </div>

                {/* Rest is dimmed & not editable when booking is off */}
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 14,
                  opacity: bookingOn ? 1 : 0.4,
                  pointerEvents: bookingOn ? 'auto' : 'none',
                }}>
                  {/* Timing card */}
                  <div style={cardStyle}>
                    <div style={cardHeaderStyle}>{t('Timing & availability')}</div>
                    <PresetRow
                      value={slotDur}
                      presets={[{ n: 15, label: '15 min' }, { n: 30, label: '30 min' }, { n: 45, label: '45 min' }, { n: 60, label: '1 h' }, { n: 90, label: '1 h 30' }]}
                      min={5} max={240} unit={t('min')}
                      setter={(n) => update('slot_duration_minutes', n)}
                      labelFor={t('sm.field.slot_duration')}
                    />
                    <PresetRow
                      value={horizon}
                      presets={[{ n: 7, label: '1 sem.' }, { n: 15, label: '15 ' + t('sm.unit.days') }, { n: 30, label: '30 ' + t('sm.unit.days') }, { n: 60, label: '60 ' + t('sm.unit.days') }, { n: 90, label: '90 ' + t('sm.unit.days') }]}
                      min={1} max={365} unit={t('sm.unit.days')}
                      setter={(n) => update('booking_horizon_days', n)}
                      labelFor={t('sm.field.horizon_days')}
                    />
                    <PresetRow
                      value={leadHrs}
                      presets={[{ n: 0, label: t('None') }, { n: 1, label: '1 h' }, { n: 2, label: '2 h' }, { n: 4, label: '4 h' }, { n: 24, label: '24 h' }, { n: 48, label: '48 h' }]}
                      min={0} max={168} unit="h"
                      setter={(n) => update('min_booking_lead_hours', n)}
                      labelFor={t('sm.field.lead_hours')}
                    />
                  </div>

                  {/* Capacity card */}
                  <div style={cardStyle}>
                    <div style={cardHeaderStyle}>{t('Capacity limits')}</div>
                    <PresetRow
                      value={perSlot}
                      presets={[{ n: 1, label: '1' }, { n: 2, label: '2' }, { n: 3, label: '3' }, { n: 5, label: '5' }, { n: 10, label: '10' }]}
                      min={1} max={50} unit={t('per slot')}
                      setter={(n) => update('slots_per_interval', n)}
                      labelFor={t('sm.field.slots_per_interval')}
                    />

                    <div>
                      <label style={labelStyle}>{t('sm.field.daily_limit')}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => update('daily_ticket_limit', 0)}
                          style={pillStyle(dailyLim === 0)}
                        >{t('Unlimited')}</button>
                        <span style={unitStyle}>{t('or')}</span>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '2px 4px 2px 8px', borderRadius: 999,
                          border: `1px solid ${dailyLim > 0 ? 'var(--primary, #3b82f6)' : 'var(--border, #475569)'}`,
                          background: dailyLim > 0 ? 'rgba(59,130,246,0.08)' : 'transparent',
                        }}>
                          <input
                            type="number"
                            value={dailyLim > 0 ? dailyLim : ''}
                            min={0} max={500}
                            placeholder={t('Unlimited')}
                            onChange={(e) => {
                              const s = e.target.value;
                              if (s === '') { update('daily_ticket_limit', 0); return; }
                              const n = Number(s);
                              if (Number.isFinite(n)) update('daily_ticket_limit', Math.max(0, Math.min(500, n)));
                            }}
                            style={{ ...numInputStyle, width: 70, border: 'none', background: 'transparent', padding: '2px 0', textAlign: 'center' }}
                          />
                          <span style={unitStyle}>/{t('day')}</span>
                        </div>
                      </div>
                      <div style={helpStyle}>{t('Cap the total number of bookings per day for this office. Unlimited = no cap.')}</div>
                    </div>
                  </div>

                  {/* Customer controls card */}
                  <div style={cardStyle}>
                    <div style={cardHeaderStyle}>{t('Customer controls')}</div>

                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>
                          {t('sm.field.allow_cancel')}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 3 }}>
                          {t('Customers can cancel their booking from the confirmation link or chat before the appointment.')}
                        </div>
                      </div>
                      <Toggle on={cancelOn} onChange={(v) => update('allow_cancellation', v)} />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--border, #475569)', paddingTop: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>
                          {t('sm.field.require_appointment_approval')}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 3 }}>
                          {t('sm.help.require_appointment_approval')}
                        </div>
                      </div>
                      <Toggle on={approvalOn} onChange={(v) => update('require_appointment_approval', v)} />
                    </div>
                  </div>

                  {/* Live summary */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '10px 14px', borderRadius: 10,
                    background: 'rgba(59,130,246,0.08)',
                    border: '1px solid rgba(59,130,246,0.25)',
                    fontSize: 12, color: 'var(--text, #f1f5f9)',
                  }}>
                    <span style={{ fontSize: 14 }}>📋</span>
                    <span style={{ fontWeight: 600 }}>{t('Summary')}:</span>
                    {summaryBits.map((s, i) => (
                      <span key={i} style={{
                        padding: '2px 8px', borderRadius: 999,
                        background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #475569)',
                        fontSize: 11, fontWeight: 500,
                      }}>{s}</span>
                    ))}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3, #64748b)' }}>
                      {approvalOn ? t('Needs approval') : t('Auto-confirmed')}
                      {' · '}
                      {cancelOn ? t('Cancellable') : t('Non-cancellable')}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      );
    }

    return (
      <div>
        {/* Logo + org name at top of business section */}
        {sec.id === 'business' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)' }}>
            <div style={{
              width: 72, height: 72, flexShrink: 0,
              borderRadius: 10, background: 'var(--bg, #0f172a)',
              border: '1px dashed var(--border, #475569)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--text3, #64748b)' }}>Q</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)', marginBottom: 2 }}>{t('Company logo')}</div>
              <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginBottom: 8 }}>
                {t('Shown on the station header, tickets, kiosk & display. PNG, JPG, WebP or SVG, max 2MB.')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  style={{ display: 'none' }}
                  onChange={(e) => handleLogoFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  disabled={logoUploading}
                  onClick={() => logoInputRef.current?.click()}
                  style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: 'var(--primary, #3b82f6)', color: '#fff',
                    border: 'none', cursor: logoUploading ? 'wait' : 'pointer', opacity: logoUploading ? 0.6 : 1,
                  }}
                >
                  {logoUploading ? t('Uploading…') : (logoUrl ? t('Replace logo') : t('Upload logo'))}
                </button>
                {logoUrl && !logoUploading && (
                  <button
                    type="button"
                    onClick={handleLogoRemove}
                    style={{
                      padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                      background: 'transparent', color: 'var(--text2, #94a3b8)',
                      border: '1px solid var(--border, #475569)', cursor: 'pointer',
                    }}
                  >
                    {t('Remove')}
                  </button>
                )}
              </div>
              {logoError && <div style={{ ...errStyle, marginTop: 6 }}>{logoError}</div>}
            </div>
          </div>
        )}
        {sec.id === 'business' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 20, rowGap: 0, marginBottom: 4 }}>
            <div style={{ padding: '5px 0' }}>
              <label style={labelStyle}>{t('sm.field.org_name')}</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                style={inputStyle}
              />
              {errors['__org_name'] && <div style={errStyle}>{errors['__org_name']}</div>}
            </div>
            <div style={{ padding: '5px 0' }}>
              <label style={labelStyle}>{t('sm.field.org_name_ar')}</label>
              <input
                type="text"
                value={orgNameAr}
                onChange={(e) => setOrgNameAr(e.target.value)}
                style={{ ...inputStyle, direction: 'rtl', textAlign: 'right' }}
                placeholder="الاسم بالعربية"
              />
            </div>
          </div>
        )}
        {sec.id === 'business' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            columnGap: 20,
            rowGap: 0,
            marginBottom: 4,
          }}>
            <div style={{ padding: '5px 0' }}>
              <label style={labelStyle}>{t('Wilaya')}</label>
              <select
                value={officeWilaya}
                onChange={(e) => {
                  setOfficeWilaya(e.target.value);
                  setOfficeCity(''); // reset city when wilaya changes
                }}
                style={inputStyle}
              >
                <option value="">{t('Select wilaya')}</option>
                {ALGERIA_WILAYAS.map((w) => (
                  <option key={w.code} value={w.code}>{w.code} — {w.name}</option>
                ))}
              </select>
            </div>
            <div style={{ padding: '5px 0' }}>
              <label style={labelStyle}>{t('City')}</label>
              <select
                value={officeCity}
                onChange={(e) => setOfficeCity(e.target.value)}
                disabled={!officeWilaya}
                style={{ ...inputStyle, opacity: officeWilaya ? 1 : 0.5 }}
              >
                <option value="">
                  {officeWilaya ? t('Select city') : t('Select wilaya first')}
                </option>
                {(officeWilaya ? getCommunes(officeWilaya) : []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          columnGap: 20,
          rowGap: 0,
        }}>
          {sec.fields.map(renderField)}
        </div>
      </div>
    );
  }

  // Find the active section object (for content rendering)
  const activeSec = sections.find(s => s.id === activeSection);
  // In search mode, find the filtered version of active section
  const activeFilteredSec = q ? filteredSections.find(s => s.id === activeSection) : activeSec;

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

        {/* Body: 2-panel layout */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text2, #94a3b8)', padding: 40, width: '100%' }}>{t('Loading...')}</p>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: 40, width: '100%' }}>
              <p style={{ color: 'var(--danger, #ef4444)', marginBottom: 12 }}>{error}</p>
              <button onClick={load} style={{
                background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>{t('Retry')}</button>
            </div>
          ) : (
            <>
              {/* LEFT: Side navigation */}
              <div style={{
                width: 240, flexShrink: 0,
                borderRight: '1px solid var(--border, #475569)',
                overflowY: 'auto',
                padding: '8px 0',
                background: 'var(--bg, #0f172a)',
              }}>
                {navItems.map(item => {
                  const isActive = activeSection === item.id;
                  // In search mode, dim non-matching sections
                  const isMatchingInSearch = !q || (
                    item.id === 'schedule'
                      ? scheduleMatchesSearch
                      : filteredSections.some(s => s.id === item.id)
                  );
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveSection(item.id)}
                      style={{
                        width: '100%', textAlign: 'left', border: 'none',
                        padding: '8px 14px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
                        color: isActive ? 'var(--primary, #3b82f6)' : 'var(--text, #f1f5f9)',
                        borderLeft: isActive ? '3px solid var(--primary, #3b82f6)' : '3px solid transparent',
                        fontSize: 13, fontWeight: isActive ? 700 : 500,
                        opacity: isMatchingInSearch ? 1 : 0.35,
                        transition: 'background 0.1s, opacity 0.1s',
                      }}
                    >
                      <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* RIGHT: Content panel */}
              <div style={{
                flex: 1, overflowY: 'auto', padding: '16px 22px',
              }}>
                {activeSection === 'account' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>👤 {t('Account')}</h3>

                    {/* Change Email */}
                    <div style={{ background: 'var(--surface2, #334155)', borderRadius: 10, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t('Change Email')}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 11, color: 'var(--text3, #64748b)', display: 'block', marginBottom: 4 }}>{t('Email')}</label>
                          <input
                            type="email"
                            value={acctEmail}
                            onChange={(e) => setAcctEmail(e.target.value)}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)', fontSize: 13 }}
                          />
                        </div>
                        <button
                          onClick={handleUpdateEmail}
                          disabled={acctEmailBusy}
                          style={{ padding: '8px 14px', borderRadius: 6, background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: acctEmailBusy ? 'not-allowed' : 'pointer', opacity: acctEmailBusy ? 0.6 : 1, whiteSpace: 'nowrap' }}
                        >{acctEmailBusy ? t('Loading...') : t('Update Email')}</button>
                      </div>
                      {acctEmailMsg && (
                        <div style={{ marginTop: 8, fontSize: 12, color: acctEmailMsg.ok ? '#22c55e' : '#ef4444' }}>{acctEmailMsg.text}</div>
                      )}
                    </div>

                    {/* Change Password */}
                    <div style={{ background: 'var(--surface2, #334155)', borderRadius: 10, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t('Change Password')}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text3, #64748b)', display: 'block', marginBottom: 4 }}>{t('New Password')}</label>
                          <input
                            type="password"
                            value={acctNewPassword}
                            onChange={(e) => setAcctNewPassword(e.target.value)}
                            placeholder={t('Minimum 6 characters')}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)', fontSize: 13 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text3, #64748b)', display: 'block', marginBottom: 4 }}>{t('Confirm Password')}</label>
                          <input
                            type="password"
                            value={acctConfirmPassword}
                            onChange={(e) => setAcctConfirmPassword(e.target.value)}
                            placeholder={t('Repeat new password')}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)', fontSize: 13 }}
                          />
                        </div>
                        <button
                          onClick={handleUpdatePassword}
                          disabled={acctPwdBusy || !acctNewPassword}
                          style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 6, background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: acctPwdBusy || !acctNewPassword ? 'not-allowed' : 'pointer', opacity: acctPwdBusy || !acctNewPassword ? 0.6 : 1 }}
                        >{acctPwdBusy ? t('Loading...') : t('Update Password')}</button>
                      </div>
                      {acctPwdMsg && (
                        <div style={{ marginTop: 8, fontSize: 12, color: acctPwdMsg.ok ? '#22c55e' : '#ef4444' }}>{acctPwdMsg.text}</div>
                      )}
                    </div>
                  </div>
                ) : activeSection === 'schedule' ? (
                  scheduleMatchesSearch ? renderScheduleContent() : (
                    <p style={{ textAlign: 'center', color: 'var(--text3, #64748b)', padding: 30 }}>
                      {t('sm.no_results')}
                    </p>
                  )
                ) : activeFilteredSec ? (
                  renderSectionContent(activeFilteredSec)
                ) : q ? (
                  <p style={{ textAlign: 'center', color: 'var(--text3, #64748b)', padding: 30 }}>
                    {t('sm.no_results')}
                  </p>
                ) : null}
              </div>
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
