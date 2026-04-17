import { describe, it, expect } from 'vitest';
import {
  ORG_SETTINGS,
  listOrgSettings,
  readAllOrgSettings,
  writeOrgSetting,
  type OrgSettingKey,
} from '../org-settings';

/**
 * Mock Supabase client that records every call and lets tests inspect
 * what update(s) would hit the DB. No network, pure in-memory.
 */
function mockSupabase(initialOrg: any = { id: 'org1', settings: {} }, offices: any[] = []) {
  let orgRow = { ...initialOrg };
  let officeRows = offices.map((o) => ({ ...o }));
  const calls: any[] = [];

  const makeChain = (table: string, rowFilter?: (r: any) => boolean) => {
    let filteredOrg = orgRow;
    let filteredOffices = officeRows.filter((r) => (rowFilter ? rowFilter(r) : true));
    const chain: any = {
      select(_cols: string) {
        const c: any = {
          eq: (col: string, val: any) => ({
            single: () => {
              if (table === 'organizations' && col === 'id') {
                return Promise.resolve({ data: orgRow.id === val ? orgRow : null, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
            // List form used by the offices.settings mirror fetch
            then: (resolve: any) => {
              if (table === 'offices' && col === 'organization_id') {
                return resolve({ data: officeRows.filter((o) => o.organization_id === val), error: null });
              }
              return resolve({ data: null, error: null });
            },
          }),
        };
        return c;
      },
      update(patch: any) {
        return {
          eq: (col: string, val: any) => {
            calls.push({ table, op: 'update', patch, filter: { [col]: val } });
            if (table === 'organizations' && col === 'id' && orgRow.id === val) {
              orgRow = { ...orgRow, ...patch };
            } else if (table === 'offices' && col === 'id') {
              officeRows = officeRows.map((r) => (r.id === val ? { ...r, ...patch } : r));
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return chain;
  };

  return {
    from(table: string) {
      return makeChain(table);
    },
    _state: () => ({ orgRow, officeRows, calls }),
  } as any;
}

/* ── Registry integrity ─────────────────────────────────────────── */

describe('ORG_SETTINGS registry', () => {
  it('every entry has dbKey, storage, and default', () => {
    for (const [name, def] of Object.entries(ORG_SETTINGS)) {
      expect(def.dbKey, `${name}.dbKey`).toBeDefined();
      expect(def.storage, `${name}.storage`).toMatch(/^(column|settings_json|settings_json_mirror_offices)$/);
      expect(def, `${name}`).toHaveProperty('default');
    }
  });

  it('every dbKey is unique within its storage bucket', () => {
    const buckets: Record<string, Set<string>> = {
      column: new Set(),
      settings_json: new Set(),
      settings_json_mirror_offices: new Set(),
    };
    for (const [name, def] of Object.entries(ORG_SETTINGS)) {
      const bucket = buckets[def.storage as keyof typeof buckets];
      expect(bucket.has(def.dbKey), `dup dbKey ${def.dbKey} (${name})`).toBe(false);
      bucket.add(def.dbKey);
    }
  });

  it('listOrgSettings returns every registered key', () => {
    const listed = listOrgSettings();
    expect(listed.length).toBe(Object.keys(ORG_SETTINGS).length);
  });
});

/* ── Read path ──────────────────────────────────────────────────── */

describe('readAllOrgSettings', () => {
  it('returns defaults when the org row is empty', async () => {
    const sb = mockSupabase({ id: 'org1', settings: {} });
    const snap = await readAllOrgSettings(sb, 'org1');
    expect(snap.default_check_in_mode).toBe(ORG_SETTINGS.default_check_in_mode.default);
    expect(snap.whatsapp_enabled).toBe(false);
    expect(snap.always_open).toBe(false);
    expect(snap.booking_horizon_days).toBe(7);
  });

  it('reads values from settings JSON', async () => {
    const sb = mockSupabase({
      id: 'org1',
      settings: { whatsapp_enabled: true, booking_horizon_days: 14 },
    });
    const snap = await readAllOrgSettings(sb, 'org1');
    expect(snap.whatsapp_enabled).toBe(true);
    expect(snap.booking_horizon_days).toBe(14);
  });

  it('falls back to legacy column when new key is absent', async () => {
    const sb = mockSupabase({
      id: 'org1',
      settings: {},
      check_in_mode: 'manual',           // legacy column
      ticket_prefix: 'LEG',              // legacy column
      auto_no_show_minutes: 15,          // legacy column
    });
    const snap = await readAllOrgSettings(sb, 'org1');
    expect(snap.default_check_in_mode).toBe('manual');
    expect(snap.ticket_number_prefix).toBe('LEG');
    expect(snap.auto_no_show_timeout).toBe(15);
  });

  it('canonical key wins over legacy column', async () => {
    const sb = mockSupabase({
      id: 'org1',
      settings: { default_check_in_mode: 'hybrid' }, // new
      check_in_mode: 'manual',                       // legacy
    });
    const snap = await readAllOrgSettings(sb, 'org1');
    expect(snap.default_check_in_mode).toBe('hybrid');
  });

  it('applies transform on read (always_open string → boolean)', async () => {
    const sb = mockSupabase({
      id: 'org1',
      settings: { visit_intake_override_mode: 'always_open' },
    });
    const snap = await readAllOrgSettings(sb, 'org1');
    expect(snap.always_open).toBe(true);
  });

  it('reads column-storage fields (name, slug, logo_url)', async () => {
    const sb = mockSupabase({
      id: 'org1',
      settings: {},
      name: 'Acme', slug: 'acme', logo_url: 'https://x/l.png',
    });
    const snap = await readAllOrgSettings(sb, 'org1');
    expect(snap.name).toBe('Acme');
    expect(snap.slug).toBe('acme');
    expect(snap.logo_url).toBe('https://x/l.png');
  });
});

/* ── Write path ─────────────────────────────────────────────────── */

describe('writeOrgSetting', () => {
  it('writes a column-storage field to the column', async () => {
    const sb = mockSupabase({ id: 'org1', settings: {} });
    await writeOrgSetting(sb, 'org1', 'name', 'New Name');
    const { calls } = sb._state();
    expect(calls).toContainEqual({
      table: 'organizations', op: 'update',
      patch: { name: 'New Name' }, filter: { id: 'org1' },
    });
  });

  it('writes a JSON-storage field to settings, preserving siblings', async () => {
    const sb = mockSupabase({
      id: 'org1',
      settings: { existing_key: 'keep_me', whatsapp_enabled: false },
    });
    await writeOrgSetting(sb, 'org1', 'booking_horizon_days', 21);
    const { orgRow } = sb._state();
    expect(orgRow.settings).toEqual({
      existing_key: 'keep_me',
      whatsapp_enabled: false,
      booking_horizon_days: 21,
    });
  });

  it('applies transform on write (always_open boolean → string)', async () => {
    const sb = mockSupabase({ id: 'org1', settings: {} }, []);
    await writeOrgSetting(sb, 'org1', 'always_open', true);
    const { orgRow } = sb._state();
    expect(orgRow.settings.visit_intake_override_mode).toBe('always_open');
  });

  it('mirrors to offices.settings when storage is settings_json_mirror_offices', async () => {
    const sb = mockSupabase(
      { id: 'org1', settings: {} },
      [
        { id: 'office1', organization_id: 'org1', settings: { unrelated: 'x' } },
        { id: 'office2', organization_id: 'org1', settings: {} },
      ],
    );
    await writeOrgSetting(sb, 'org1', 'always_open', true);
    const { officeRows } = sb._state();
    expect(officeRows[0].settings.visit_intake_override_mode).toBe('always_open');
    expect(officeRows[0].settings.unrelated).toBe('x'); // sibling preserved
    expect(officeRows[1].settings.visit_intake_override_mode).toBe('always_open');
  });

  it('round-trip: write then read returns the same value', async () => {
    const sb = mockSupabase({ id: 'org1', settings: {} }, []);
    await writeOrgSetting(sb, 'org1', 'whatsapp_code', 'JOIN');
    await writeOrgSetting(sb, 'org1', 'booking_mode', 'advanced');
    await writeOrgSetting(sb, 'org1', 'always_open', true);
    const snap = await readAllOrgSettings(sb, 'org1');
    expect(snap.whatsapp_code).toBe('JOIN');
    expect(snap.booking_mode).toBe('advanced');
    expect(snap.always_open).toBe(true);
  });
});
