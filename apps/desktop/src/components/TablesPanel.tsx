import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { summarizeOccupancy, type RestaurantTable, type TableStatus } from '@qflo/shared';

// ── Tables management panel ────────────────────────────────────────
// Full CRUD for restaurant_tables, live occupancy summary, manual
// clear action, and realtime updates via the tickets:changed event
// (any ticket mutation could have freed or claimed a table).

interface Props {
  officeId: string | null;
  locale: DesktopLocale;
  canManage: boolean;
}

const STATUS_STYLES: Record<TableStatus, { bg: string; fg: string }> = {
  available: { bg: 'rgba(34,197,94,0.18)', fg: '#86efac' },
  occupied:  { bg: 'rgba(239,68,68,0.18)', fg: '#fca5a5' },
  reserved:  { bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' },
  cleaning:  { bg: 'rgba(245,158,11,0.18)', fg: '#fcd34d' },
  disabled:  { bg: 'rgba(148,163,184,0.18)', fg: '#cbd5e1' },
};

interface TableForm {
  id?: string;
  code: string;
  label: string;
  capacity: number;
  min_party_size: number | null;
  max_party_size: number | null;
  zone: string;
  reservable: boolean;
  status: TableStatus;
}

const EMPTY_FORM: TableForm = {
  code: '', label: '', capacity: 4,
  min_party_size: null, max_party_size: null,
  zone: '', reservable: true, status: 'available',
};

export function TablesPanel({ officeId, locale, canManage }: Props) {
  const t = useCallback((k: string, vars?: Record<string, any>) => translate(locale, k, vars), [locale]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TableForm | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!officeId) { setTables([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { data, error: err } = await sb
        .from('restaurant_tables')
        .select('id, office_id, code, label, zone, capacity, min_party_size, max_party_size, reservable, status, current_ticket_id, assigned_at')
        .eq('office_id', officeId)
        .order('code');
      if (err) throw err;
      setTables((data ?? []) as RestaurantTable[]);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, [officeId]);

  useEffect(() => { load(); }, [load]);

  // Live refresh when any ticket changes — tickets can occupy/release
  // tables via the desk panel or auto-release when completed.
  useEffect(() => {
    const unsub = (window as any).qf?.tickets?.onChange?.(load);
    return () => { unsub?.(); };
  }, [load]);

  const occupancy = useMemo(() => summarizeOccupancy(tables), [tables]);

  const save = async () => {
    if (!form || !officeId || busy) return;
    if (!form.code.trim()) { setError(t('Code is required')); return; }
    if (!form.label.trim()) { setError(t('Label is required')); return; }
    setBusy(true);
    setError(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const payload: any = {
        office_id: officeId,
        code: form.code.trim(),
        label: form.label.trim(),
        capacity: form.capacity,
        min_party_size: form.min_party_size,
        max_party_size: form.max_party_size,
        zone: form.zone.trim() || null,
        reservable: form.reservable,
        status: form.status,
      };
      if (form.id) {
        const { error: err } = await sb.from('restaurant_tables').update(payload).eq('id', form.id);
        if (err) throw err;
      } else {
        const { error: err } = await sb.from('restaurant_tables').insert(payload);
        if (err) throw err;
      }
      setForm(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const clearTable = async (table: RestaurantTable) => {
    setBusy(true);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error: err } = await sb
        .from('restaurant_tables')
        .update({ status: 'available', current_ticket_id: null, assigned_at: null })
        .eq('id', table.id);
      if (err) throw err;
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Clear failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (table: RestaurantTable) => {
    if (!confirm(t('Delete {code}?', { code: table.code }))) return;
    setBusy(true);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error: err } = await sb.from('restaurant_tables').delete().eq('id', table.id);
      if (err) throw err;
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  if (!officeId) {
    return <p style={{ color: 'var(--text3)', padding: 24 }}>{t('Select an office to manage tables.')}</p>;
  }

  return (
    <div>
      {/* Live occupancy bar */}
      <OccupancyBar occupancy={occupancy} t={t} />

      {/* Toolbar */}
      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {t('{n} tables', { n: tables.length })}
          </div>
          <button
            onClick={() => {
              // Suggest the next free T-number by scanning existing codes.
              // Matches "T12" → 12 and skips anything that doesn't fit the
              // pattern (custom codes like "VIP-A" are simply ignored and
              // won't influence the suggestion).
              const used = new Set<number>();
              for (const tbl of tables) {
                const m = /^T(\d+)$/i.exec(tbl.code.trim());
                if (m) used.add(parseInt(m[1], 10));
              }
              let next = 1;
              while (used.has(next)) next++;
              setForm({ ...EMPTY_FORM, code: `T${next}`, label: `Table ${next}` });
            }}
            style={btnPrimary}
          >
            + {t('Add table')}
          </button>
        </div>
      )}

      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, marginBottom: 12,
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
          color: '#fca5a5', fontSize: 12,
        }}>{error}</div>
      )}

      {loading ? (
        <p style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>{t('Loading...')}</p>
      ) : tables.length === 0 ? (
        <p style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          {t('No tables yet.')} {canManage && t('Click "Add table" to create your first one.')}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {[...tables].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' })).map((tbl) => (
            <TableCard
              key={tbl.id}
              table={tbl}
              canManage={canManage}
              onEdit={() => setForm({
                id: tbl.id,
                code: tbl.code,
                label: tbl.label,
                capacity: tbl.capacity ?? 4,
                min_party_size: tbl.min_party_size ?? null,
                max_party_size: tbl.max_party_size ?? null,
                zone: tbl.zone ?? '',
                reservable: tbl.reservable ?? true,
                status: tbl.status,
              })}
              onClear={() => clearTable(tbl)}
              onDelete={() => remove(tbl)}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Edit/create modal */}
      {form && (
        <FormModal
          form={form}
          onChange={setForm}
          onSave={save}
          onCancel={() => { setForm(null); setError(null); }}
          busy={busy}
          t={t}
        />
      )}
    </div>
  );
}

function OccupancyBar({ occupancy, t }: { occupancy: ReturnType<typeof summarizeOccupancy>; t: (k: string, v?: any) => string }) {
  const pct = Math.round(occupancy.seatUtilisation * 100);
  return (
    <div style={{
      background: 'var(--surface2)',
      borderRadius: 10,
      padding: 14,
      marginBottom: 14,
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text2)' }}>
          {t('Live occupancy')}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>
          {pct}% <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)' }}>
            ({occupancy.seatsOccupied}/{occupancy.seatsTotal} {t('seats')})
          </span>
        </div>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(148,163,184,0.2)', overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e', transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
        <Stat label={t('Available')} value={occupancy.available} color="#22c55e" />
        <Stat label={t('Occupied')} value={occupancy.occupied} color="#ef4444" />
        <Stat label={t('Reserved')} value={occupancy.reserved} color="#3b82f6" />
        <Stat label={t('Cleaning')} value={occupancy.cleaning} color="#f59e0b" />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ color: 'var(--text2)' }}>{label}:</span>
      <span style={{ fontWeight: 700, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function TableCard({
  table, canManage, onEdit, onClear, onDelete, t,
}: {
  table: RestaurantTable;
  canManage: boolean;
  onEdit: () => void;
  onClear: () => void;
  onDelete: () => void;
  t: (k: string, v?: any) => string;
}) {
  const sty = STATUS_STYLES[table.status];
  return (
    <div style={{
      padding: 12,
      borderRadius: 10,
      background: 'var(--surface2)',
      border: `2px solid ${sty.fg}40`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{table.code}</span>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
          background: sty.bg, color: sty.fg, textTransform: 'uppercase', letterSpacing: 0.4,
        }}>{t(table.status)}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>{table.label}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
        👥 {table.capacity ?? '?'}
        {(table.min_party_size != null || table.max_party_size != null) && (
          <span> · {table.min_party_size ?? 1}–{table.max_party_size ?? (table.capacity ?? '?')}</span>
        )}
        {table.zone && <span> · {table.zone}</span>}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {table.status === 'occupied' && canManage && (
          <button onClick={onClear} style={{ ...btnAction, background: '#16a34a', color: '#fff' }}>
            ✓ {t('Clear')}
          </button>
        )}
        {canManage && (
          <>
            <button onClick={onEdit} style={btnAction}>{t('Edit')}</button>
            <button onClick={onDelete} style={{ ...btnAction, color: '#fca5a5' }}>{t('Delete')}</button>
          </>
        )}
      </div>
    </div>
  );
}

function FormModal({
  form, onChange, onSave, onCancel, busy, t,
}: {
  form: TableForm;
  onChange: (f: TableForm) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  t: (k: string, v?: any) => string;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 12, padding: 20,
        maxWidth: 420, width: '100%', border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          {form.id ? t('Edit table') : t('Add table')}
        </div>

        <Field label={t('Code')}>
          <input
            value={form.code}
            onChange={(e) => onChange({ ...form, code: e.target.value })}
            placeholder="T1"
            style={input}
          />
        </Field>

        <Field label={t('Label')}>
          <input
            value={form.label}
            onChange={(e) => onChange({ ...form, label: e.target.value })}
            placeholder="Table 1"
            style={input}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <Field label={t('Capacity')}>
            <input
              type="number" min={1}
              value={form.capacity}
              onChange={(e) => onChange({ ...form, capacity: parseInt(e.target.value, 10) || 1 })}
              style={input}
            />
          </Field>
          <Field label={t('Min party')}>
            <input
              type="number" min={1}
              value={form.min_party_size ?? ''}
              onChange={(e) => onChange({ ...form, min_party_size: e.target.value ? parseInt(e.target.value, 10) : null })}
              placeholder="—"
              style={input}
            />
          </Field>
          <Field label={t('Max party')}>
            <input
              type="number" min={1}
              value={form.max_party_size ?? ''}
              onChange={(e) => onChange({ ...form, max_party_size: e.target.value ? parseInt(e.target.value, 10) : null })}
              placeholder="—"
              style={input}
            />
          </Field>
        </div>

        <Field label={t('Zone')}>
          <input
            value={form.zone}
            onChange={(e) => onChange({ ...form, zone: e.target.value })}
            placeholder={t('e.g. Terrace, Indoor, VIP')}
            style={input}
          />
        </Field>

        <Field label={t('Status')}>
          <select
            value={form.status}
            onChange={(e) => onChange({ ...form, status: e.target.value as TableStatus })}
            style={{ ...input, colorScheme: 'light dark' }}
          >
            <option value="available">{t('available')}</option>
            <option value="occupied">{t('occupied')}</option>
            <option value="reserved">{t('reserved')}</option>
            <option value="cleaning">{t('cleaning')}</option>
            <option value="disabled">{t('disabled')}</option>
          </select>
        </Field>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text)' }}>
          <input
            type="checkbox"
            checked={form.reservable}
            onChange={(e) => onChange({ ...form, reservable: e.target.checked })}
          />
          {t('Accepts reservations')}
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onCancel} disabled={busy} style={btnGhost}>{t('Cancel')}</button>
          <button onClick={onSave} disabled={busy} style={btnPrimary}>
            {busy ? t('Saving...') : t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text)', fontSize: 13,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6,
  background: 'var(--primary)', color: '#fff',
  border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6,
  background: 'transparent', color: 'var(--text)',
  border: '1px solid var(--border)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnAction: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4,
  background: 'var(--surface)', color: 'var(--text2)',
  border: '1px solid var(--border)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
