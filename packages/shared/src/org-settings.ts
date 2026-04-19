/**
 * Org-level settings registry — single source of truth.
 *
 * Why this exists
 * ───────────────
 * QFlo has three clients that all read/write organization settings: the
 * QFlo Station desktop app, the web admin dashboard, and the Expo mobile
 * app. Historically each client independently picked the key name and
 * storage location (top-level column vs `organizations.settings` JSON vs
 * `offices.settings` JSON). Result: settings drift — a value set on one
 * client didn't show up on another. Example: Station stored 24/7 as
 * `organizations.settings.visit_intake_override_mode = 'always_open'`,
 * mobile wrote per-day operating_hours; neither saw the other's change.
 *
 * Going forward every org-level setting lives in `ORG_SETTINGS` below.
 * Clients use {@link readAllOrgSettings} / {@link writeOrgSetting}; they
 * don't hand-roll `.update({ settings: {...} })` or touch column names
 * directly. A static guard test (see `org-settings-guard.test.ts` in each
 * client) fails CI if anyone bypasses this module.
 *
 * Adding a new setting
 * ────────────────────
 * 1. Add an entry to {@link ORG_SETTINGS}.
 * 2. Every client reads it via `snapshot[key]` and writes via
 *    `writeOrgSetting(supabase, orgId, key, value)`.
 * 3. Routing (column vs JSON, mirror-to-offices, legacy-column fallback)
 *    happens automatically — the individual client code stays identical.
 *
 * Storage options
 * ───────────────
 *  - `'column'` — top-level column on `organizations`. Use sparingly;
 *    prefer JSON so new settings don't require migrations.
 *  - `'settings_json'` — key under `organizations.settings` JSONB. Default
 *    choice for new settings.
 *  - `'settings_json_mirror_offices'` — same as `settings_json`, and ALSO
 *    copied to every `offices.settings` JSON. Used for flags that must be
 *    visible in per-office contexts (Station reads `visit_intake_override_mode`
 *    from offices in kiosk contexts).
 */

export type SettingStorage =
  | 'column'
  | 'settings_json'
  | 'settings_json_mirror_offices';

/** Metadata for one registered setting. */
export interface SettingDef<T = unknown> {
  /** The canonical key Supabase stores. Must match what Station + web read. */
  dbKey: string;
  storage: SettingStorage;
  default: T;
  /**
   * Optional UI ↔ DB value transform, e.g. boolean mobile/web toggle that
   * stores as `'always_open' | 'business_hours'` in the DB.
   */
  transform?: {
    toDb: (v: T) => unknown;
    fromDb: (v: unknown) => T;
  };
  /**
   * Legacy location to fall back to on READ. Use when a setting used to live
   * as a top-level column and we need older rows to still surface the value.
   * Writes always go to `dbKey` at the canonical `storage`.
   */
  legacyColumn?: string;
}

/* ── Registry ──────────────────────────────────────────────────────── */

export const ORG_SETTINGS = {
  // ── Identity (columns) ────────────────────────────────────────────
  name:     { dbKey: 'name',     storage: 'column', default: '' as string } as SettingDef<string>,
  slug:     { dbKey: 'slug',     storage: 'column', default: '' as string } as SettingDef<string>,
  logo_url: { dbKey: 'logo_url', storage: 'column', default: null as string | null } as SettingDef<string | null>,

  // ── Queue (settings JSON) ────────────────────────────────────────
  default_check_in_mode: {
    dbKey: 'default_check_in_mode', storage: 'settings_json',
    default: 'hybrid',
    legacyColumn: 'check_in_mode',
  } as SettingDef<string>,
  ticket_number_prefix: {
    dbKey: 'ticket_number_prefix', storage: 'settings_json',
    default: '',
    legacyColumn: 'ticket_prefix',
  } as SettingDef<string>,
  auto_no_show_timeout: {
    dbKey: 'auto_no_show_timeout', storage: 'settings_json',
    default: null as number | null,
    legacyColumn: 'auto_no_show_minutes',
  } as SettingDef<number | null>,
  max_queue_size: {
    dbKey: 'max_queue_size', storage: 'settings_json',
    default: null as number | null,
    legacyColumn: 'max_queue_size',
  } as SettingDef<number | null>,

  // ── Display (settings JSON) ──────────────────────────────────────
  default_screen_layout: {
    dbKey: 'default_screen_layout', storage: 'settings_json',
    default: 'list',
    legacyColumn: 'default_screen_layout',
  } as SettingDef<string>,
  announcement_sound_enabled: {
    dbKey: 'announcement_sound_enabled', storage: 'settings_json',
    default: true,
    legacyColumn: 'announcement_sound',
  } as SettingDef<boolean>,
  default_language: {
    dbKey: 'default_language', storage: 'settings_json',
    default: 'en',
    legacyColumn: 'default_language',
  } as SettingDef<string>,
  supported_languages: {
    dbKey: 'supported_languages', storage: 'settings_json',
    default: ['en'] as string[],
    legacyColumn: 'supported_languages',
  } as SettingDef<string[]>,

  // ── Booking & scheduling ────────────────────────────────────────
  booking_mode: {
    dbKey: 'booking_mode', storage: 'settings_json', default: 'simple',
  } as SettingDef<string>,
  booking_horizon_days: {
    dbKey: 'booking_horizon_days', storage: 'settings_json', default: 7,
  } as SettingDef<number>,
  slot_duration_minutes: {
    dbKey: 'slot_duration_minutes', storage: 'settings_json', default: 30,
  } as SettingDef<number>,
  slots_per_interval: {
    dbKey: 'slots_per_interval', storage: 'settings_json', default: 1,
  } as SettingDef<number>,
  require_appointment_approval: {
    dbKey: 'require_appointment_approval', storage: 'settings_json', default: false,
  } as SettingDef<boolean>,
  require_ticket_approval: {
    dbKey: 'require_ticket_approval', storage: 'settings_json', default: false,
  } as SettingDef<boolean>,
  allow_cancellation: {
    dbKey: 'allow_cancellation', storage: 'settings_json', default: true,
  } as SettingDef<boolean>,
  min_booking_lead_hours: {
    dbKey: 'min_booking_lead_hours', storage: 'settings_json', default: 0,
  } as SettingDef<number>,
  daily_ticket_limit: {
    dbKey: 'daily_ticket_limit', storage: 'settings_json', default: null as number | null,
  } as SettingDef<number | null>,

  // ── Messaging channels ──────────────────────────────────────────
  whatsapp_enabled: {
    dbKey: 'whatsapp_enabled', storage: 'settings_json', default: false,
  } as SettingDef<boolean>,
  whatsapp_code: {
    dbKey: 'whatsapp_code', storage: 'settings_json', default: '',
  } as SettingDef<string>,
  arabic_code: {
    dbKey: 'arabic_code', storage: 'settings_json', default: '',
  } as SettingDef<string>,
  messenger_enabled: {
    dbKey: 'messenger_enabled', storage: 'settings_json', default: false,
  } as SettingDef<boolean>,

  // ── Priority SMS alerts ─────────────────────────────────────────
  priority_alerts_sms_enabled: {
    dbKey: 'priority_alerts_sms_enabled', storage: 'settings_json', default: false,
  } as SettingDef<boolean>,
  priority_alerts_sms_on_call: {
    dbKey: 'priority_alerts_sms_on_call', storage: 'settings_json', default: true,
  } as SettingDef<boolean>,
  priority_alerts_sms_on_recall: {
    dbKey: 'priority_alerts_sms_on_recall', storage: 'settings_json', default: true,
  } as SettingDef<boolean>,
  priority_alerts_sms_on_buzz: {
    dbKey: 'priority_alerts_sms_on_buzz', storage: 'settings_json', default: true,
  } as SettingDef<boolean>,
  priority_alerts_phone_label: {
    dbKey: 'priority_alerts_phone_label', storage: 'settings_json', default: '',
  } as SettingDef<string>,

  // ── Email OTP ───────────────────────────────────────────────────
  email_otp_enabled: {
    dbKey: 'email_otp_enabled', storage: 'settings_json', default: false,
  } as SettingDef<boolean>,
  email_otp_required_for_booking: {
    dbKey: 'email_otp_required_for_booking', storage: 'settings_json', default: false,
  } as SettingDef<boolean>,

  // ── Priorities feature master toggle ───────────────────────────
  priorities_enabled: {
    dbKey: 'priorities_enabled', storage: 'settings_json', default: true,
  } as SettingDef<boolean>,

  // ── Intake gate (mirrors to offices per Station's convention) ───
  always_open: {
    dbKey: 'visit_intake_override_mode',
    storage: 'settings_json_mirror_offices',
    default: false,
    transform: {
      toDb: (on: boolean) => (on ? 'always_open' : 'business_hours'),
      fromDb: (v: unknown) => v === 'always_open',
    },
  } as SettingDef<boolean>,
} as const;

/** Union of every registered setting name. */
export type OrgSettingKey = keyof typeof ORG_SETTINGS;

/** Map from key → native value type (honors the `default` typing). */
export type OrgSettingValue<K extends OrgSettingKey> =
  (typeof ORG_SETTINGS)[K] extends SettingDef<infer T> ? T : never;

/** A batch-loaded snapshot of every setting for an org. */
export type OrgSettingsSnapshot = {
  [K in OrgSettingKey]: OrgSettingValue<K>;
};

/* ── Helpers ───────────────────────────────────────────────────────── */

/**
 * Supabase client interface — narrow shape to avoid pulling @supabase/supabase-js
 * types into this shared package. Real client satisfies this.
 */
export interface MinimalSupabase {
  from(table: string): {
    select(cols: string): any;
    update(patch: any): any;
    insert?(row: any): any;
  };
}

/** Extract the raw value from the DB columns for one setting. */
function extractRaw(def: SettingDef, orgRow: any, orgSettingsJson: Record<string, any>): unknown {
  if (def.storage === 'column') {
    return orgRow?.[def.dbKey];
  }
  // settings_json and settings_json_mirror_offices both live on org.settings
  const v = orgSettingsJson?.[def.dbKey];
  if (v === undefined || v === null) {
    // Fall back to legacy column (rows created before the migration)
    if (def.legacyColumn && orgRow?.[def.legacyColumn] !== undefined) {
      return orgRow[def.legacyColumn];
    }
  }
  return v;
}

function decode<K extends OrgSettingKey>(key: K, raw: unknown): OrgSettingValue<K> {
  const def = ORG_SETTINGS[key] as SettingDef;
  if (raw === undefined || raw === null) return def.default as OrgSettingValue<K>;
  if (def.transform) return def.transform.fromDb(raw) as OrgSettingValue<K>;
  return raw as OrgSettingValue<K>;
}

function encode(def: SettingDef, value: unknown): unknown {
  if (def.transform) return def.transform.toDb(value);
  return value;
}

/**
 * Read every registered setting for an org in a single round-trip.
 * Returns a fully-populated snapshot with defaults filled in for missing keys.
 */
export async function readAllOrgSettings(
  supabase: MinimalSupabase,
  orgId: string,
): Promise<OrgSettingsSnapshot> {
  const { data } = await supabase.from('organizations').select('*').eq('id', orgId).single();
  const orgRow = (data ?? {}) as Record<string, any>;
  const json = (orgRow.settings as Record<string, any>) ?? {};

  const snapshot: any = {};
  for (const [name, def] of Object.entries(ORG_SETTINGS)) {
    const raw = extractRaw(def as SettingDef, orgRow, json);
    snapshot[name] = decode(name as OrgSettingKey, raw);
  }
  return snapshot as OrgSettingsSnapshot;
}

/**
 * Write a single org setting. Handles column vs JSON routing, mirrors to
 * offices when required, and applies the transform if one is defined.
 *
 * Returns an error if the DB write failed; null on success. Never throws.
 */
export async function writeOrgSetting<K extends OrgSettingKey>(
  supabase: MinimalSupabase,
  orgId: string,
  key: K,
  value: OrgSettingValue<K>,
): Promise<{ error: unknown | null }> {
  const def = ORG_SETTINGS[key] as SettingDef;
  const encoded = encode(def, value);

  try {
    if (def.storage === 'column') {
      const { error } = await supabase
        .from('organizations').update({ [def.dbKey]: encoded }).eq('id', orgId);
      return { error: error ?? null };
    }

    // JSON path — re-fetch-merge-write to avoid clobbering siblings
    const { data: row } = await supabase
      .from('organizations').select('settings').eq('id', orgId).single();
    const current = ((row as any)?.settings as Record<string, any>) ?? {};
    const merged = { ...current, [def.dbKey]: encoded };
    const { error } = await supabase
      .from('organizations').update({ settings: merged }).eq('id', orgId);
    if (error) return { error };

    // Mirror to every office's settings JSON when required
    if (def.storage === 'settings_json_mirror_offices') {
      const { data: officeRows } = await supabase
        .from('offices').select('id, settings').eq('organization_id', orgId);
      const rows = (officeRows as any[]) ?? [];
      await Promise.all(rows.map((r: any) => {
        const s = (r.settings as Record<string, any>) ?? {};
        return supabase
          .from('offices')
          .update({ settings: { ...s, [def.dbKey]: encoded } })
          .eq('id', r.id);
      }));
    }

    return { error: null };
  } catch (e) {
    return { error: e };
  }
}

/**
 * Public list of (setting-key, DB-key) pairs for documentation/testing.
 * Used by the static guard test to know which raw keys are allowed.
 */
export function listOrgSettings(): { name: OrgSettingKey; dbKey: string }[] {
  return (Object.keys(ORG_SETTINGS) as OrgSettingKey[]).map((name) => ({
    name,
    dbKey: (ORG_SETTINGS[name] as SettingDef).dbKey,
  }));
}
