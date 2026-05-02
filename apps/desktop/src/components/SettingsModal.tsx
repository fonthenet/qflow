import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { PrioritiesEditor } from './PrioritiesEditor';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { TeamModal } from './TeamModal';
import { BusinessAdminModal } from './BusinessAdminModal';
import { MenuEditor } from './MenuEditor';
import { PrintersSection } from './PrintersSection';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { speak, buildSample, parseVoiceSettings } from '../lib/voice';
import {
  VOICE_CATALOG,
  PRESET_KEYS,
  getFieldLabel,
  migrateToIntakeFields,
  ensureAllPresets,
  BUSINESS_CATEGORIES,
  COUNTRIES,
  getBusinessCategoryByVertical,
  resolveLocalized,
  type IntakeField,
  type IntakeFieldScope,
  type CategoryLocale,
} from '@qflo/shared';
import DatePicker from './DatePicker';
import TimePicker from './TimePicker';
import { ALGERIA_WILAYAS, getCommunes } from '../lib/algeria-wilayas';

function generateCustomFieldKey(existing: IntakeField[]): string {
  const taken = new Set(existing.map(f => f.key));
  let n = 1;
  while (taken.has(`custom_${n}`)) n++;
  return `custom_${n}`;
}
// ── End Intake Fields types ─────────────────────────────────────

// ── Floating Mini Queue toggle ──────────────────────────────────
// Station-local preference — controls whether minimizing the Station
// pops a small always-on-top card with the current called/serving
// tickets. Persisted in the SQLite session table via main process
// IPC so it survives restarts.
function StationPrefToggleCard({ t, icon, title, help, getEnabled, setEnabled: persist, defaultEnabled }: {
  t: (k: string, v?: any) => string;
  icon: string;
  title: string;
  help: string;
  getEnabled: () => Promise<boolean> | boolean;
  setEnabled: (v: boolean) => Promise<unknown> | unknown;
  defaultEnabled: boolean;
}) {
  const [enabled, setEnabledState] = useState(defaultEnabled);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.resolve(getEnabled()).then((v) => {
      setEnabledState(!!v);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (next: boolean) => {
    setEnabledState(next);
    try { await persist(next); } catch {}
  };

  return (
    <div style={{ background: 'var(--surface2, #334155)', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{icon} {title}</div>
          <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', lineHeight: 1.4 }}>{help}</div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!loaded}
            onChange={(e) => toggle(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{
            position: 'absolute', cursor: loaded ? 'pointer' : 'wait',
            top: 0, left: 0, right: 0, bottom: 0,
            background: enabled ? 'var(--primary, #3b82f6)' : 'var(--border, #475569)',
            transition: '0.2s', borderRadius: 24,
          }}>
            <span style={{
              position: 'absolute',
              height: 18, width: 18, left: enabled ? 22 : 3, top: 3,
              background: '#fff', transition: '0.2s', borderRadius: '50%',
            }} />
          </span>
        </label>
      </div>
    </div>
  );
}

function MiniQueueToggleCard({ t }: { t: (k: string, v?: any) => string }) {
  return (
    <StationPrefToggleCard
      t={t}
      icon="📌"
      title={t('Floating mini queue')}
      help={t('When you minimize Qflo Station and there is an active call, show a small floating card with quick actions (Start, Complete, Recall, Cancel).')}
      getEnabled={() => (window as any).qf?.mini?.getEnabled?.() ?? true}
      setEnabled={(v) => (window as any).qf?.mini?.setEnabled?.(v)}
      defaultEnabled={true}
    />
  );
}

// Per-device touch-mode toggle. Stored in localStorage (NOT in the
// org settings) so a single business can run a desktop install on the
// host stand and a tablet install at the door with different settings.
// Dispatches a custom event so App.tsx applies the body class
// instantly without a reload.
function TouchModeToggleCard({ t }: { t: (k: string, v?: any) => string }) {
  return (
    <StationPrefToggleCard
      t={t}
      icon="👆"
      title={t('Touch mode')}
      help={t('Enlarges every button and input to a finger-sized tap target. Use on touchscreens and tablets. Per-device setting — does not affect other staff.')}
      getEnabled={() => {
        try { return localStorage.getItem('qflo_touch_mode') === 'true'; } catch { return false; }
      }}
      setEnabled={(v) => {
        try {
          localStorage.setItem('qflo_touch_mode', v ? 'true' : 'false');
          window.dispatchEvent(new CustomEvent('qflo:touch-mode-changed'));
          // Mirror to main process so it can hide the native menu bar
          // and persist across restarts independently of the renderer's
          // localStorage. Fire-and-forget — CSS class already applied.
          (window as any).qf?.touchMode?.setEnabled?.(v);
        } catch {}
      }}
      defaultEnabled={false}
    />
  );
}

// Sync-mode picker — Cloud Sync vs Local + Backup. Per-Station setting,
// switches live without a restart. Driving rationale: shops with bad
// internet, or owners who want zero risk of cloud sync ghosting their
// queue, can run the Station fully offline-first with a periodic safety
// backup. Customer-facing cloud features (online booking, WhatsApp,
// public displays) are hidden in Local + Backup mode — see the consumers
// of useSyncMode().
function SyncModeCard({ t }: { t: (k: string, v?: any) => string }) {
  const [mode, setMode] = useState<'cloud' | 'local_backup'>('cloud');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clickCount, setClickCount] = useState(0); // diagnostic — visible counter so we know the click handler ran

  useEffect(() => {
    const api = (window as any).qf?.syncMode;
    if (!api?.get) return;
    Promise.resolve()
      .then(() => api.get())
      .then((m: 'cloud' | 'local_backup') => { if (m) setMode(m); })
      .catch((e: any) => {
        // eslint-disable-next-line no-console
        console.warn('[SyncModeCard] get failed:', e);
      });
    const off = api.onChanged?.((m: 'cloud' | 'local_backup') => setMode(m));
    return () => { try { off?.(); } catch {} };
  }, []);

  const choose = async (target: 'cloud' | 'local_backup') => {
    setClickCount((c) => c + 1); // always bumps — proves the handler fired
    if (target === mode || busy) return;
    setBusy(true);
    setErrorMsg(null);
    const previous = mode;
    setMode(target);
    try {
      const api = (window as any).qf?.syncMode;
      if (!api?.set) throw new Error('IPC bridge missing');
      const result = await api.set(target);
      if (result?.mode && result.mode !== target) {
        setMode(result.mode);
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[SyncModeCard] set failed:', e);
      setErrorMsg(e?.message ?? String(e));
      setMode(previous);
    } finally {
      setBusy(false);
    }
  };

  const renderCard = (value: 'cloud' | 'local_backup', icon: string, title: string, body: string, badges: string[]) => {
    const active = mode === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => choose(value)}
        disabled={busy}
        style={{
          flex: 1, minWidth: 280,
          textAlign: 'start',
          padding: 14,
          borderRadius: 10,
          border: `2px solid ${active ? 'var(--primary, #3b82f6)' : 'var(--border, #475569)'}`,
          background: active ? 'rgba(59,130,246,0.1)' : 'transparent',
          color: 'var(--text)',
          cursor: busy ? 'wait' : 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minHeight: 140,
          opacity: busy && !active ? 0.6 : 1,
          // Defensive: ensure the button captures clicks even if a parent
          // sets pointer-events: none somewhere.
          pointerEvents: 'auto',
          position: 'relative',
          zIndex: 1,
        }}
        aria-pressed={active}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
          {active && (
            <span style={{ marginInlineStart: 'auto', fontSize: 10, fontWeight: 700, background: 'var(--primary, #3b82f6)', color: '#fff', padding: '2px 8px', borderRadius: 10 }}>
              {t('Active')}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', lineHeight: 1.4, pointerEvents: 'none' }}>{body}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto', pointerEvents: 'none' }}>
          {badges.map((b) => (
            <span key={b} style={{
              fontSize: 10, fontWeight: 600,
              background: 'var(--surface, #1e293b)', color: 'var(--text2, #94a3b8)',
              padding: '2px 7px', borderRadius: 8,
              border: '1px solid var(--border, #475569)',
            }}>{b}</span>
          ))}
        </div>
      </button>
    );
  };

  return (
    <div style={{ background: 'var(--surface2, #334155)', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>☁️ {t('Cloud sync mode')}</div>
        {clickCount > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 10,
            background: 'rgba(34,197,94,0.15)', color: '#22c55e',
          }}>
            clicks: {clickCount}{busy ? ' (working…)' : ''}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', lineHeight: 1.4, marginBottom: 12 }}>
        {t('Choose how this Station talks to the cloud. Switch any time — no restart.')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {renderCard(
          'cloud',
          '☁️',
          t('Cloud Sync'),
          t('Real-time push and pull. Customers can book online, receive WhatsApp updates, and watch the public display. Best for normal operation with reliable internet.'),
          [t('Online booking'), t('WhatsApp'), t('Public displays'), t('Multi-device')],
        )}
        {renderCard(
          'local_backup',
          '💾',
          t('Local + Backup'),
          t('Station runs entirely from local storage. A backup is uploaded to the cloud every 6 hours so your data is safe. Customer-facing online features are hidden in this mode.'),
          [t('No realtime'), t('No online booking'), t('Backup every 6h'), t('Works offline')],
        )}
      </div>
      {errorMsg && (
        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(239,68,68,0.12)', color: '#ef4444',
          fontSize: 11, fontWeight: 600,
        }}>
          ⚠ {errorMsg}
        </div>
      )}
    </div>
  );
}

function NotificationsToggleCard({ t }: { t: (k: string, v?: any) => string }) {
  return (
    <StationPrefToggleCard
      t={t}
      icon="🔔"
      title={t('Desktop notifications')}
      help={t('Show a Windows toast when a customer joins the queue (WhatsApp, web, kiosk) or cancels their ticket. Walk-in tickets you create here are skipped.')}
      getEnabled={() => (window as any).qf?.notifications?.getEnabled?.() ?? false}
      setEnabled={(v) => (window as any).qf?.notifications?.setEnabled?.(v)}
      defaultEnabled={false}
    />
  );
}

interface Props {
  organizationId: string;
  officeId?: string;
  locale: DesktopLocale;
  storedAuth?: { access_token?: string; refresh_token?: string; email?: string; password?: string };
  officeName?: string;
  callerUserId?: string;
  callerRole?: string;
  initialSection?: string;
  onClose: () => void;
  onSaved?: () => void;
  onOpenTeam?: () => void;
  onOpenBusinessAdmin?: () => void;
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

type FieldType = 'bool' | 'num' | 'text' | 'textarea' | 'enum' | 'multi' | 'horizon' | 'stepper' | 'color' | 'header' | 'button';

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
  /** For sections that expose sub-tabs: which tab this field belongs to. */
  tab?: string;
}

interface SectionTabDef {
  id: string;
  label: string;
}

interface SectionDef {
  id: string;
  icon: string;
  title: string;
  fields: FieldDef[];
  /** Extra fields not in `fields` but still need init/save (for merged sections with sub-tabs) */
  _allFields?: FieldDef[];
  /** Optional sub-tabs rendered at the top of the section content. Fields
   * carry a `tab` matching one of these ids; only matching fields render
   * when the tab is active. */
  tabs?: SectionTabDef[];
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
export function SettingsModal({ organizationId, officeId, locale, storedAuth, officeName, callerUserId, callerRole, initialSection, onClose, onSaved, onOpenTeam, onOpenBusinessAdmin }: Props) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [search, setSearch] = useState('');
  // Remember the last-used section + sub-tabs across opens so admins who
  // iterate on one area (e.g. Display & kiosk → voice) don't have to
  // re-navigate every time they reopen the modal. Caller-supplied
  // `initialSection` still wins when explicitly passed.
  const LS_SECTION = 'qf_settings_last_section';
  const LS_BOOKING_TAB = 'qf_settings_last_booking_tab';
  const LS_SECTION_TAB = 'qf_settings_last_section_tab';
  const [activeSection, setActiveSection] = useState(() => {
    if (initialSection) return initialSection;
    try { return localStorage.getItem(LS_SECTION) ?? 'booking'; } catch { return 'booking'; }
  });
  const [activeSectionTab, setActiveSectionTab] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(LS_SECTION_TAB);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [bookingSubTab, setBookingSubTab] = useState<'intake' | 'queue' | 'appointments' | 'priorities'>(() => {
    try {
      const v = localStorage.getItem(LS_BOOKING_TAB);
      if (v === 'intake' || v === 'queue' || v === 'appointments' || v === 'priorities') return v;
    } catch { /* ignore */ }
    return 'intake';
  });
  useEffect(() => { try { localStorage.setItem(LS_SECTION, activeSection); } catch { /* ignore */ } }, [activeSection]);
  useEffect(() => { try { localStorage.setItem(LS_BOOKING_TAB, bookingSubTab); } catch { /* ignore */ } }, [bookingSubTab]);
  useEffect(() => { try { localStorage.setItem(LS_SECTION_TAB, JSON.stringify(activeSectionTab)); } catch { /* ignore */ } }, [activeSectionTab]);
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
  // Initial placeholder only — real org timezone loads from
  // organizations.timezone below. UTC is neutral so US/FR/etc orgs
  // never briefly render Algerian times.
  const [officeTimezone, setOfficeTimezone] = useState<string>('UTC');
  const [originalTimezone, setOriginalTimezone] = useState<string>('UTC');
  // Org country (ISO alpha-2, e.g. 'DZ', 'US', 'FR'). Drives which
  // country-specific UI to render — wilaya picker + Arabic-name field
  // are Algeria-only and must never render for US/FR/etc orgs.
  const [orgCountry, setOrgCountry] = useState<string>('');
  const [originalOrgCountry, setOriginalOrgCountry] = useState<string>('');
  const isAlgeria = orgCountry === 'DZ';
  // Countries whose operators typically want an Arabic display name
  // alongside the Latin one. Gating the Arabic-name field on the full
  // Arabic-speaking country set (not just DZ) keeps the UI clean for
  // US/FR/IN/etc. orgs while still surfacing it for MA/TN/EG/AE/SA where
  // it's genuinely useful.
  const ARABIC_COUNTRIES = new Set([
    'DZ', 'MA', 'TN', 'EG', 'AE', 'SA', 'OM', 'QA', 'KW', 'JO',
    'LB', 'BH', 'YE', 'LY', 'IQ', 'SY', 'PS', 'SD',
  ]);
  const showArabicName = ARABIC_COUNTRIES.has(orgCountry);
  // Org's business category (from settings.business_category) — decides
  // whether the catalog section renders as "Menu" (restaurant/cafe),
  // "Products" (telecom/automotive/beauty/other retail-adjacent) or is
  // hidden entirely (pure-service categories: gov, bank, healthcare,
  // legal, insurance, real_estate, education — those already manage their
  // offering via Business Administration → Services).
  const [businessCategory, setBusinessCategory] = useState<string>('');
  const catalogSection = (() => {
    if (businessCategory === 'restaurant' || businessCategory === 'cafe') {
      return { id: 'menu', icon: '🍽️', title: t('Menu') };
    }
    // Retail-adjacent: these categories typically sell physical inventory
    // alongside services, so expose the same editor but label it Products.
    if (
      businessCategory === 'telecom' ||
      businessCategory === 'automotive' ||
      businessCategory === 'beauty' ||
      businessCategory === 'other'
    ) {
      return { id: 'menu', icon: '📦', title: t('Products') };
    }
    // Pure-service categories (or category not yet set) — no catalog tab.
    return null;
  })();
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

  // If the admin changes voice language or gender and the currently-picked
  // voice_id no longer matches the new filter, reset it back to "Auto".
  // Otherwise the dropdown would silently keep a stale id that overrides
  // the visible selections at announcement time.
  useEffect(() => {
    const vid = values.voice_id;
    if (!vid) return;
    const match = VOICE_CATALOG.find((v) => v.id === vid);
    if (!match) return;
    const langMismatch = values.voice_language && values.voice_language !== 'auto' && match.language !== values.voice_language;
    const genderMismatch = values.voice_gender && match.gender !== values.voice_gender;
    if (langMismatch || genderMismatch) {
      setValues((prev) => ({ ...prev, voice_id: '' }));
    }
  }, [values.voice_language, values.voice_gender]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Section & field definitions ─────────────────────────────────
  const sections: SectionDef[] = useMemo(() => [
    {
      id: 'business',
      icon: '🏢',
      title: t('sm.section.business'),
      fields: [
        // Org name handled separately (not in settings jsonb)
        // Category list is the single source of truth from @qflo/shared.
        // Portal, Station and Expo all share the same enum so wizard →
        // DB → Station round-trips never lose fidelity (previously this
        // was a local enum of {clinic|dentist|pharmacy|…} that didn't
        // overlap with wizard's {healthcare|banking|government|…},
        // causing orgs to render as "Other").
        { key: 'business_category', label: t('sm.field.business_category'), type: 'enum', default: 'other', options:
          BUSINESS_CATEGORIES.map((c) => ({
            value: c.value,
            label: `${c.emoji} ${resolveLocalized(c.label, (locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fr') as CategoryLocale)}`,
          })),
        },
        // Country + city — captured at signup but not previously
        // surfaced in this Business info form. Showing them here so
        // operators can correct or edit post-signup; the values feed
        // currency rendering, country-gated payment rails, and the
        // public directory.
        { key: 'business_country', label: t('Country'), type: 'enum', default: '', options:
          [{ value: '', label: '—' }, ...COUNTRIES.map((c) => ({
            value: c.code,
            label: `${c.flag} ${resolveLocalized(c.name, (locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fr') as CategoryLocale)}`,
          }))],
        },
        { key: 'business_city', label: t('City'), type: 'text', default: '', placeholder: 'Algiers, Paris, Casablanca…' },
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
      title: t('sm.section.display_kiosk'),
      tabs: [
        { id: 'kiosk', label: t('sm.section.kiosk') },
        { id: 'display', label: t('sm.section.display') },
      ],
      fields: [
        // ── Kiosk tab ─────────────────────────────────────────────────
        { key: '__hdr_kiosk_flow', tab: 'kiosk', label: t('sm.hdr.kiosk_flow'), type: 'header', default: null, help: t('sm.hdr.kiosk_flow_help') },
        { key: 'kiosk_mode', tab: 'kiosk', label: t('sm.field.kiosk_mode'), type: 'enum', default: 'normal', options: [
          { value: 'normal', label: t('sm.kiosk_mode.normal') },
          { value: 'quick_book', label: t('sm.kiosk_mode.quick_book') },
        ], help: t('sm.help.kiosk_mode') },
        { key: 'kiosk_idle_timeout', tab: 'kiosk', label: t('sm.field.kiosk_idle'), type: 'num', default: 60, min: 10, help: t('sm.help.kiosk_idle') },
        { key: 'kiosk_show_estimated_time', tab: 'kiosk', label: t('sm.field.kiosk_show_eta'), type: 'bool', default: true },
        { key: 'kiosk_show_priorities', tab: 'kiosk', label: t('sm.field.kiosk_show_priorities'), type: 'bool', default: false },

        { key: '__hdr_kiosk_brand', tab: 'kiosk', label: t('sm.hdr.kiosk_brand'), type: 'header', default: null },
        { key: 'kiosk_welcome_message', tab: 'kiosk', label: t('sm.field.kiosk_welcome'), type: 'text', default: '', placeholder: t('sm.ph.kiosk_welcome') },
        { key: 'kiosk_header_text', tab: 'kiosk', label: t('sm.field.kiosk_header'), type: 'text', default: '', placeholder: t('sm.ph.kiosk_header') },
        { key: 'kiosk_button_label', tab: 'kiosk', label: t('sm.field.kiosk_button'), type: 'text', default: '', placeholder: t('sm.ph.kiosk_button') },
        { key: 'kiosk_theme_color', tab: 'kiosk', label: t('sm.field.kiosk_theme'), type: 'color', default: '#3b82f6', placeholder: '#3b82f6', help: t('sm.help.kiosk_theme') },
        { key: 'kiosk_show_logo', tab: 'kiosk', label: t('sm.field.kiosk_show_logo'), type: 'bool', default: true, help: t('sm.help.kiosk_show_logo') },
        { key: 'kiosk_logo_url', tab: 'kiosk', label: t('sm.field.kiosk_logo_url'), type: 'text', default: '', placeholder: 'https://…/logo.png', help: t('sm.help.kiosk_logo_url') },

        // ── Display tab ───────────────────────────────────────────────
        { key: '__hdr_sound', tab: 'display', label: t('sm.hdr.sound'), type: 'header', default: null, help: t('sm.hdr.sound_help') },
        { key: 'announcement_sound_enabled', tab: 'display', label: t('sm.field.announcement_sound'), type: 'bool', default: true, help: t('sm.help.announcement_sound') },
        { key: 'voice_announcements', tab: 'display', label: t('sm.field.voice_announcements'), type: 'bool', default: true, help: t('sm.help.voice_announcements') },
        { key: 'voice_language', tab: 'display', label: t('sm.field.voice_language'), type: 'enum', default: 'fr', options: [
          { value: 'auto', label: t('sm.voice_language.auto') },
          { value: 'ar', label: t('sm.voice_language.ar') },
          { value: 'fr', label: t('sm.voice_language.fr') },
          { value: 'en', label: t('sm.voice_language.en') },
        ], help: t('sm.help.voice_language') },
        { key: 'voice_gender', tab: 'display', label: t('sm.field.voice_gender'), type: 'enum', default: 'female', options: [
          { value: 'female', label: t('sm.voice_gender.female') },
          { value: 'male', label: t('sm.voice_gender.male') },
        ], help: t('sm.help.voice_gender') },
        { key: 'voice_id', tab: 'display', label: t('sm.field.voice_name'), type: 'enum', default: 'fr-FR-DeniseNeural', options: [
          { value: '', label: t('sm.voice_name.auto') },
          ...VOICE_CATALOG.map((v) => ({
            value: v.id,
            label: `${v.displayName} — ${t('sm.voice_language.' + v.language)} (${t('sm.voice_gender.' + v.gender)}) · ${t('sm.voice_desc.' + v.descriptionKey)}`,
          })),
        ], help: t('sm.help.voice_name') },
        { key: 'voice_rate', tab: 'display', label: t('sm.field.voice_rate'), type: 'num', default: 90, min: 60, max: 130, help: t('sm.help.voice_rate') },
        // Per-org audio output device. Empty string = Windows default
        // (main-process sound-play). Non-empty = renderer HTMLAudioElement
        // with setSinkId — routes to a specific speaker / PA amp.
        // Options populated dynamically by the renderer at field-render time.
        { key: 'voice_output_device_id', tab: 'display', label: t('sm.field.audio_output'), type: 'enum', default: '', options: [
          { value: '', label: t('sm.audio_output.default') },
        ], help: t('sm.help.audio_output') },
        { key: '__voice_test', tab: 'display', label: t('sm.field.voice_test'), type: 'button', default: null, help: t('sm.help.voice_test') },
        // Announcement chime is now ship-with-the-app — every business
        // hears the same approved PA sound out of the box, so there's no
        // per-org upload/preview/reset UI. If we ever expose
        // customisation again, the IPC (chime:pick-and-install etc.) and
        // chime.ts multi-source resolution are still in place.
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
    {
      id: 'team',
      icon: '👥',
      title: t('Team & Staff'),
      fields: [], // Custom-rendered: opens TeamModal
    },
    {
      id: 'business_admin',
      icon: '🏢',
      title: t('Business Administration'),
      fields: [], // Custom-rendered: opens BusinessAdminModal
    },
    // Catalog tab — only shown for categories that actually sell items.
    // Restaurant/cafe → "Menu"; telecom/automotive/beauty/other → "Products";
    // pure-service categories (gov/bank/healthcare/legal/insurance/real_estate/
    // education/services) → hidden (they manage their offering via
    // Business Administration → Services instead).
    ...(catalogSection
      ? [{
          id: catalogSection.id,
          icon: catalogSection.icon,
          title: catalogSection.title,
          fields: [] as any[], // Custom-rendered: embeds MenuEditor
        }]
      : []),
    {
      id: 'printers',
      icon: '🖨️',
      title: t('Printers'),
      fields: [], // Custom-rendered: PrintersSection
    },
    {
      id: 'diagnostics',
      icon: '🩺',
      title: t('Sync Diagnostics'),
      fields: [], // Custom-rendered
    },
  ], [locale, catalogSection?.id, catalogSection?.title, catalogSection?.icon]); // eslint-disable-line react-hooks/exhaustive-deps

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
        sb.from('organizations').select('name, name_ar, settings, timezone, logo_url, country, vertical').eq('id', orgId).single(),
        officeId
          ? sb.from('offices').select('operating_hours, settings, wilaya, city').eq('id', officeId).single()
          : Promise.resolve({ data: null, error: null }),
        officeId
          ? sb.from('office_holidays').select('*').eq('office_id', officeId).order('holiday_date', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (err) { setError(err.message); return; }
      const s: SettingsShape = ((data as any)?.settings ?? {}) as SettingsShape;
      // Portal's platform-template wizard writes `platform_vertical` +
      // top-level `vertical` but not `business_category`. Station's
      // dropdown + catalog-tab gating both key off `business_category`,
      // so derive it from the vertical when absent. This keeps older
      // orgs (and orgs provisioned via the portal wizard) rendering the
      // right category + catalog tab instead of falling back to "Other".
      const rawCategory = (s as any)?.business_category as string | null | undefined;
      if (!rawCategory) {
        const vert =
          ((data as any)?.vertical as string | null | undefined) ??
          ((s as any)?.platform_vertical as string | null | undefined);
        const derived = getBusinessCategoryByVertical(vert ?? undefined);
        if (derived) (s as any).business_category = derived;
      }
      originalRef.current = { ...s };
      const name = ((data as any)?.name ?? '') as string;
      setOrgName(name);
      setOriginalOrgName(name);
      const nameAr = ((data as any)?.name_ar ?? '') as string;
      setOrgNameAr(nameAr);
      setOriginalOrgNameAr(nameAr);
      setLogoUrl(((data as any)?.logo_url ?? null) as string | null);
      {
        const c = String(((data as any)?.country ?? '')).toUpperCase();
        setOrgCountry(c);
        setOriginalOrgCountry(c);
      }
      // Use the possibly-derived value written into `s` above, so
      // the catalog-tab gating sees the real category even for orgs
      // provisioned by the platform wizard.
      setBusinessCategory(String(((s as any)?.business_category ?? '')).toLowerCase());

      // Load org-level timezone (single source of truth for the business)
      const orgTz = (data as any)?.timezone || 'UTC';
      setOfficeTimezone(orgTz);
      setOriginalTimezone(orgTz);

      // Load office operating hours
      if (officeResult?.data) {
        const ofc = officeResult.data as any;
        const wilaya = typeof ofc.wilaya === 'string' ? ofc.wilaya : '';
        const officeCityRaw = typeof ofc.city === 'string' ? ofc.city : '';
        // Fall back to settings.business_city when the office row hasn't
        // captured it yet — shell-signup flows write city to settings
        // before any office exists, and the wizard may create the office
        // later without copying the selected city across.
        const settingsCity = String((s as any)?.business_city ?? '');
        const city = officeCityRaw || settingsCity;
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
      } else {
        // No office yet — still surface the city chosen during signup so
        // the operator sees what was selected and can edit it.
        const settingsCity = String((s as any)?.business_city ?? '');
        setOfficeCity(settingsCity);
        setOriginalCity(settingsCity);
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
    if (orgCountry !== originalOrgCountry) return true;
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
  }, [values, allFieldKeys, orgName, originalOrgName, orgNameAr, originalOrgNameAr, officeTimezone, originalTimezone, officeWilaya, originalWilaya, officeCity, originalCity, schedule, originalSchedule, holidays, originalHolidays, orgCountry, originalOrgCountry]);

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
          if (f.type === 'header' || f.type === 'button') return;
          if (f.key.startsWith('__')) return;
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
      // Mirror city to settings.business_city so shell-signup orgs (which
      // may not have an office row yet) still round-trip the selected city.
      // Keeps the two locations in sync even when the office does exist.
      if (officeCity !== originalCity) {
        (merged as any).business_city = officeCity || null;
      }
      const updatePayload: any = { settings: merged };
      if (orgName !== originalOrgName) updatePayload.name = orgName;
      if (orgNameAr !== originalOrgNameAr) updatePayload.name_ar = orgNameAr || null;
      if (orgCountry !== originalOrgCountry) updatePayload.country = orgCountry || null;
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
      // Warm the offline TTS cache for the newly-saved voice + rate so
      // ticket calls keep working if the internet drops after this.
      try {
        (window as any).qf?.voice?.prewarm?.({
          voiceId: merged.voice_id ?? null,
          language: merged.voice_language ?? 'auto',
          gender: merged.voice_gender ?? 'female',
          rate: merged.voice_rate ?? 90,
        });
      } catch { /* non-fatal — background retry will cover it */ }
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

  // Toggle lives at module scope (see end of file). Defining it inside
  // this component gave React a new component identity on every render,
  // which caused the underlying <button> to unmount/remount during any
  // upstream state change — enough to drop a click if it landed in the
  // wrong tick. This kept the "Always open" toggle feeling unresponsive.

  // Action buttons rendered by schema (type === 'button'). Keyed by field.key.
  // Handlers receive the live form state so they can read the latest unsaved
  // values (e.g. test the voice with the currently-chosen gender/rate).
  const [voiceTestResult, setVoiceTestResult] = useState<{ ok: boolean; label: string } | null>(null);
  const [audioOutputs, setAudioOutputs] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [audioScanError, setAudioScanError] = useState<string | null>(null);
  const refreshAudioOutputs = useCallback(async () => {
    try {
      const { listAudioOutputs } = await import('../lib/voice');
      const list = await listAudioOutputs();
      setAudioOutputs(list);
      setAudioScanError(list.length === 0 ? t('No speakers detected — check Windows Sound settings') : null);
      // eslint-disable-next-line no-console
      console.info('[settings] audio outputs detected:', list);
    } catch (err: any) {
      setAudioScanError(err?.message ?? String(err));
    }
  }, [t]);
  useEffect(() => { void refreshAudioOutputs(); }, [refreshAudioOutputs]);
  const buttonHandlers: Record<string, (state: Record<string, any>) => void> = {
    __voice_test: async (state) => {
      const settings = parseVoiceSettings({
        voice_announcements: true, // force on for the test even if toggle is off
        voice_gender: state.voice_gender,
        voice_language: state.voice_language,
        voice_rate: state.voice_rate,
        voice_id: state.voice_id,
      });
      // Derive the sample language from the picked voice_id first, then
      // voice_language, then fall back to the UI locale. Otherwise an
      // Arabic voice would read the English/French sample sentence and
      // sound like "English words with an Arabic accent" — not useful for
      // auditioning the voice.
      const voiceLang = state.voice_id ? String(state.voice_id).slice(0, 2).toLowerCase() : '';
      const sampleLangShort = voiceLang === 'ar' || voiceLang === 'fr' || voiceLang === 'en'
        ? voiceLang
        : (state.voice_language && state.voice_language !== 'auto' ? state.voice_language : locale);
      const fallback = sampleLangShort === 'ar' ? 'ar-SA'
        : sampleLangShort === 'fr' ? 'fr-FR' : 'en-US';
      setVoiceTestResult(null);
      const result = await speak(buildSample(fallback), settings, fallback);
      if (result.path === 'kiosk-server') {
        setVoiceTestResult({ ok: true, label: `✅ Natural: ${result.voice}` });
      } else if (result.path === 'browser') {
        setVoiceTestResult({ ok: false, label: `⚠️ Fallback to OS voice (${result.voice}). Reason: ${result.reason ?? 'unknown'}` });
      } else {
        setVoiceTestResult({ ok: false, label: `❌ Voice playback failed: ${result.reason ?? 'unknown'}` });
      }
    },
  };

  const formState = values;

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
      // Voice picker is filtered by the sibling language + gender selects
      // so admins only see voices that actually match — otherwise picking
      // "French / Female" then an Arabic male voice would silently
      // override the language/gender choice, which is how we ended up
      // with English announcements earlier.
      let options = f.options ?? [];
      if (f.key === 'voice_output_device_id') {
        options = [
          { value: '', label: t('sm.audio_output.default') },
          ...audioOutputs.map((d) => ({ value: d.deviceId, label: d.label })),
        ];
      }
      if (f.key === 'voice_id') {
        const langFilter = values.voice_language && values.voice_language !== 'auto'
          ? String(values.voice_language)
          : null;
        const genderFilter = values.voice_gender ? String(values.voice_gender) : null;
        options = [
          { value: '', label: t('sm.voice_name.auto') },
          ...VOICE_CATALOG
            .filter((vc) => (!langFilter || vc.language === langFilter))
            .filter((vc) => (!genderFilter || vc.gender === genderFilter))
            .map((vc) => ({
              value: vc.id,
              label: `${vc.displayName} — ${t('sm.voice_language.' + vc.language)} (${t('sm.voice_gender.' + vc.gender)}) · ${t('sm.voice_desc.' + vc.descriptionKey)}`,
            })),
        ];
      }
      return (
        <div key={f.key} style={{ padding: '5px 0' }}>
          <label style={labelStyle}>{f.label}</label>
          {f.key === 'voice_output_device_id' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={v ?? f.default} onChange={(e) => setV(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => void refreshAudioOutputs()}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  border: '1px solid var(--border, #475569)',
                  background: 'var(--surface, #1e293b)', color: 'var(--text, #f1f5f9)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {t('Refresh')}
              </button>
            </div>
          ) : (
            <select value={v ?? f.default} onChange={(e) => setV(e.target.value)} style={inputStyle}>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {f.help && <div style={helpStyle}>{f.help}</div>}
          {f.key === 'voice_output_device_id' && (
            <div style={{ ...helpStyle, color: audioScanError ? 'var(--danger, #ef4444)' : 'var(--text3, #64748b)' }}>
              {audioScanError
                ? `⚠️ ${audioScanError}`
                : t('{n} speaker(s) detected', { n: audioOutputs.length })}
            </div>
          )}
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
    if (f.type === 'button') {
      // Action button (no persisted value). Key -> handler table.
      const handler = buttonHandlers[f.key];
      const isVoiceTest = f.key === '__voice_test';
      const icon = '🔊';
      const labelSuffix = '';
      return (
        <div key={f.key} style={{ padding: '8px 0', gridColumn: '1 / -1' }}>
          <button
            type="button"
            onClick={() => handler?.(formState)}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: '1px solid var(--border, #334155)',
              background: 'var(--surface, #1e293b)',
              color: 'var(--text, #f1f5f9)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {icon} {f.label}{labelSuffix}
          </button>
          {f.help && <div style={helpStyle}>{f.help}</div>}
          {isVoiceTest && voiceTestResult && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.4,
                background: voiceTestResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(234,179,8,0.14)',
                color: voiceTestResult.ok ? '#22c55e' : '#eab308',
                border: `1px solid ${voiceTestResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.3)'}`,
              }}
            >
              {voiceTestResult.label}
            </div>
          )}
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
              // Update the persisted flag FIRST so the UI can't get stuck
              // on a failed side-effect below (previously the JSON
              // snapshot line ran first; if that ever threw the toggle
              // click silently no-op'd).
              setValues(prev => ({ ...prev, visit_intake_override_mode: on ? 'always_open' : 'business_hours' }));
              try {
                if (on) {
                  // Turning ON: snapshot the current weekly schedule so we can
                  // put it back if the admin toggles OFF again.
                  scheduleBeforeAlwaysOpenRef.current = JSON.parse(JSON.stringify(schedule ?? {}));
                } else {
                  // Turning OFF: restore the pre-always-open snapshot if we have
                  // one, otherwise fall back to the last loaded schedule so the
                  // admin never ends up with an all-zero / blanked-out calendar.
                  const restored = scheduleBeforeAlwaysOpenRef.current ?? originalSchedule;
                  setSchedule(JSON.parse(JSON.stringify(restored ?? {})));
                }
              } catch {
                // Snapshot/restore is a convenience, not a correctness
                // requirement — failure here must not prevent the toggle
                // itself from flipping.
              }
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
              const renderStatus = (s: Availability, rtl?: boolean): React.ReactElement | null => {
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
                  {showArabicName && (
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
                  )}
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
      // Backfill missing presets so admins can always toggle on Email,
      // Party size, etc. regardless of what the org was seeded with.
      // Wilaya is DZ-only; non-DZ orgs get it stripped.
      const savedIntake: IntakeField[] = values.intake_fields ?? [];
      const intakeFields: IntakeField[] = ensureAllPresets(savedIntake, { country: orgCountry, category: businessCategory });
      // If backfill changed the array length (new presets injected or stale
      // wilaya stripped), sync back into values so save persists the new
      // shape. Effect guards against render loop.
      if (intakeFields.length !== savedIntake.length) {
        queueMicrotask(() => {
          setValues(prev => {
            const current = prev.intake_fields ?? [];
            const reconciled = ensureAllPresets(current, { country: orgCountry, category: businessCategory });
            if (reconciled.length === current.length) return prev;
            return { ...prev, intake_fields: reconciled };
          });
        });
      }
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
            {/* Arabic name field — surfaced for any Arabic-speaking
                country (MENA + Gulf). Latin-only markets like US/FR/IN
                don't get the clutter. */}
            {showArabicName && (
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
            )}
          </div>
        )}
        {sec.id === 'business' && isAlgeria && (
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
        {/* Universal Country + City block for non-Algeria orgs. Always
            rendered on the business section (even when orgCountry is
            empty — older shell orgs may not have it set yet, so we
            surface the editable dropdown here). Country is an editable
            select backed by @qflo/shared/COUNTRIES; city is a plain text
            field pre-filled from offices.city when set at signup. */}
        {sec.id === 'business' && !isAlgeria && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            columnGap: 20,
            rowGap: 0,
            marginBottom: 4,
          }}>
            <div style={{ padding: '5px 0' }}>
              <label style={labelStyle}>{t('Country')}</label>
              <select
                value={orgCountry}
                onChange={(e) => setOrgCountry(e.target.value.toUpperCase())}
                style={inputStyle}
              >
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {resolveLocalized(c.name, (locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fr') as CategoryLocale)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ padding: '5px 0' }}>
              <label style={labelStyle}>{t('City')}</label>
              <input
                type="text"
                value={officeCity}
                onChange={(e) => setOfficeCity(e.target.value)}
                style={inputStyle}
                placeholder={t('City')}
              />
            </div>
          </div>
        )}
        {(() => {
          const tabs = sec.tabs;
          const fields = sec.fields;
          // In search mode, flatten and show all matching fields across tabs.
          if (!tabs || tabs.length === 0 || q) {
            return (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                columnGap: 20,
                rowGap: 0,
              }}>
                {fields.map(renderField)}
              </div>
            );
          }
          const current = activeSectionTab[sec.id] ?? tabs[0].id;
          const filtered = fields.filter(f => (f.tab ?? tabs[0].id) === current);
          return (
            <>
              <div style={{
                display: 'flex', gap: 4, marginBottom: 14, padding: 4,
                background: 'var(--surface, #0f172a)',
                border: '1px solid var(--border, #334155)',
                borderRadius: 10, width: 'fit-content',
              }}>
                {tabs.map(tb => {
                  const active = tb.id === current;
                  return (
                    <button
                      key={tb.id}
                      type="button"
                      onClick={() => setActiveSectionTab(prev => ({ ...prev, [sec.id]: tb.id }))}
                      style={{
                        padding: '8px 18px', borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: active ? 'var(--accent, #3b82f6)' : 'transparent',
                        color: active ? '#fff' : 'var(--text2, #94a3b8)',
                        fontSize: 13, fontWeight: 600, transition: 'background 120ms ease',
                      }}
                    >
                      {tb.label}
                    </button>
                  );
                })}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                columnGap: 20,
                rowGap: 0,
              }}>
                {filtered.map(renderField)}
              </div>
            </>
          );
        })()}
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
          width: 1400, maxWidth: '96vw', height: '90vh',
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
                      onClick={() => {
                        setActiveSection(item.id);
                      }}
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
                flex: 1, overflowY: 'auto',
                padding: (activeSection === 'team' || activeSection === 'business_admin' || activeSection === 'menu') ? 0 : '16px 22px',
                display: 'flex', flexDirection: 'column', minHeight: 0,
              }}>
                {activeSection === 'diagnostics' ? (
                  <DiagnosticsPanel t={t} />
                ) : activeSection === 'team' ? (
                  callerUserId ? (
                    <TeamModal
                      embedded
                      organizationId={organizationId}
                      callerUserId={callerUserId}
                      callerRole={callerRole ?? ''}
                      locale={locale}
                      onClose={onClose}
                    />
                  ) : (
                    <p style={{ textAlign: 'center', color: 'var(--text3, #64748b)', padding: 30 }}>{t('Loading...')}</p>
                  )
                ) : activeSection === 'business_admin' ? (
                  callerUserId ? (
                    <BusinessAdminModal
                      embedded
                      organizationId={organizationId}
                      activeOfficeId={officeId ?? null}
                      callerUserId={callerUserId}
                      callerRole={callerRole ?? ''}
                      locale={locale}
                      onClose={onClose}
                    />
                  ) : (
                    <p style={{ textAlign: 'center', color: 'var(--text3, #64748b)', padding: 30 }}>{t('Loading...')}</p>
                  )
                ) : activeSection === 'menu' ? (
                  organizationId ? (
                    <MenuEditor
                      embedded
                      orgId={organizationId}
                      locale={locale}
                    />
                  ) : (
                    <p style={{ textAlign: 'center', color: 'var(--text3, #64748b)', padding: 30 }}>{t('Loading...')}</p>
                  )
                ) : activeSection === 'printers' ? (
                  <PrintersSection t={t} locale={locale} />
                ) : activeSection === 'account' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>👤 {t('Account')}</h3>

                    <SyncModeCard t={t} />
                    <TouchModeToggleCard t={t} />
                    <MiniQueueToggleCard t={t} />
                    <NotificationsToggleCard t={t} />

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
                            style={inputStyle}
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
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text3, #64748b)', display: 'block', marginBottom: 4 }}>{t('Confirm Password')}</label>
                          <input
                            type="password"
                            value={acctConfirmPassword}
                            onChange={(e) => setAcctConfirmPassword(e.target.value)}
                            placeholder={t('Repeat new password')}
                            style={inputStyle}
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

// Module-scoped stable Toggle. Keeping it out here means React preserves
// the underlying DOM node across SettingsModal re-renders; otherwise
// rapid upstream state changes (audio-device polling, localStorage sync
// effects, etc.) remount the button and occasionally drop clicks.
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
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
}
