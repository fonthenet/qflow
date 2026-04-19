import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';

// -----------------------------------------------------------------------------
// Priorities editor — full CRUD on the `priority_categories` Supabase table.
// Mirrors the web portal's /admin/priorities page so the Station and Portal
// stay in sync. Shown as a sub-tab under Settings → Booking & Queue.
// -----------------------------------------------------------------------------

type PriorityCategory = {
  id: string;
  organization_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  weight: number | null;
  is_active: boolean | null;
  created_at: string | null;
};

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
  '#14b8a6', '#f59e0b', '#0ea5e9', '#84cc16',
];

const PRESET_ICONS = [
  '♿', '🧓', '🎖️', '🤰', '👶', '🏥',
  '⭐', '🔥', '💎', '👑', '🎯', '⚡',
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣',
];

// The 3 canonical presets the kiosk/mobile priority-step expects. If a fresh
// org has no priorities configured yet, one click seeds these defaults.
const DEFAULT_PRESETS: Array<Omit<PriorityCategory, 'id' | 'organization_id' | 'created_at'>> = [
  { name: 'Accessible', icon: '♿', color: '#0ea5e9', weight: 25, is_active: true },
  { name: 'Senior',     icon: '🧓', color: '#f97316', weight: 20, is_active: true },
  { name: 'Veteran',    icon: '🎖️', color: '#22c55e', weight: 15, is_active: true },
];

export function PrioritiesEditor({
  organizationId,
  locale,
}: {
  organizationId: string;
  locale: DesktopLocale;
}) {
  const t = (k: string) => translate(locale, k);

  const [items, setItems] = useState<PriorityCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState<boolean>(true);
  const [editing, setEditing] = useState<PriorityCategory | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<{ name: string; icon: string; color: string; weight: number; is_active: boolean }>({
    name: '', icon: '⭐', color: '#3b82f6', weight: 10, is_active: true,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const [{ data, error }, orgRes] = await Promise.all([
        sb.from('priority_categories')
          .select('id, organization_id, name, icon, color, weight, is_active, created_at')
          .eq('organization_id', organizationId)
          .order('weight', { ascending: false }),
        sb.from('organizations').select('settings').eq('id', organizationId).maybeSingle(),
      ]);
      if (error) throw error;
      setItems((data ?? []) as PriorityCategory[]);
      const settings = (orgRes.data?.settings ?? {}) as Record<string, unknown>;
      const enabled = settings.priorities_enabled;
      setFeatureEnabled(enabled === undefined ? true : Boolean(enabled));
    } catch (e: any) {
      setError(e?.message ?? translate(locale, 'prio.err.load'));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setDraft({ name: '', icon: '⭐', color: '#3b82f6', weight: 10, is_active: true });
    setModalOpen(true);
  };

  const openEdit = (p: PriorityCategory) => {
    setEditing(p);
    setDraft({
      name: p.name ?? '',
      icon: p.icon ?? '⭐',
      color: p.color ?? '#6b7280',
      weight: p.weight ?? 10,
      is_active: p.is_active !== false,
    });
    setModalOpen(true);
  };

  const close = () => { setModalOpen(false); setEditing(null); };

  const save = async () => {
    if (!draft.name.trim()) {
      setError(t('prio.err.nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      if (editing) {
        const { error } = await sb.from('priority_categories').update({
          name: draft.name.trim(),
          icon: draft.icon || null,
          color: draft.color || '#6b7280',
          weight: draft.weight,
          is_active: draft.is_active,
        }).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('priority_categories').insert({
          organization_id: organizationId,
          name: draft.name.trim(),
          icon: draft.icon || null,
          color: draft.color || '#6b7280',
          weight: draft.weight,
          is_active: draft.is_active,
        });
        if (error) throw error;
      }
      close();
      await load();
    } catch (e: any) {
      setError(e?.message ?? translate(locale, 'prio.err.save'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: PriorityCategory) => {
    if (!confirm(t('prio.confirmDelete') + `\n\n${p.name}`)) return;
    setBusy(true);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error } = await sb.from('priority_categories').delete().eq('id', p.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      setError(e?.message ?? translate(locale, 'prio.err.delete'));
    } finally {
      setBusy(false);
    }
  };

  const seedPresets = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error } = await sb.from('priority_categories').insert(
        DEFAULT_PRESETS.map((p) => ({ ...p, organization_id: organizationId })),
      );
      if (error) throw error;
      await load();
    } catch (e: any) {
      setError(e?.message ?? translate(locale, 'prio.err.seed'));
    } finally {
      setBusy(false);
    }
  };

  const canSeed = useMemo(() => !loading && items.length === 0, [loading, items.length]);

  const toggleFeature = async (next: boolean) => {
    setBusy(true);
    setError(null);
    const prev = featureEnabled;
    setFeatureEnabled(next); // optimistic
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { data: current } = await sb.from('organizations').select('settings').eq('id', organizationId).maybeSingle();
      const merged = { ...((current?.settings as Record<string, unknown>) ?? {}), priorities_enabled: next };
      const { error } = await sb.from('organizations').update({ settings: merged }).eq('id', organizationId);
      if (error) throw error;
    } catch (e: any) {
      setFeatureEnabled(prev); // revert
      setError(e?.message ?? translate(locale, 'prio.err.save'));
    } finally {
      setBusy(false);
    }
  };

  // ───── Styles ─────
  const cardStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, padding: 12,
    borderRadius: 10, border: '1px solid var(--border, #475569)',
    background: 'var(--surface2, #334155)', marginBottom: 8,
  };
  const btnPrimary: React.CSSProperties = {
    padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: 'var(--primary, #3b82f6)', color: '#fff', fontSize: 12, fontWeight: 600,
  };
  const btnGhost: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
    background: 'transparent', border: '1px solid var(--border, #475569)',
    color: 'var(--text, #f1f5f9)', fontSize: 12,
  };
  const btnDanger: React.CSSProperties = { ...btnGhost, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' };
  const inputStyle: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #475569)',
    background: 'var(--surface, #1e293b)', color: 'var(--text, #f1f5f9)', fontSize: 13, width: '100%', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text2, #94a3b8)', marginBottom: 4, display: 'block' };

  return (
    <div>
      {/* ── Master feature toggle ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 14, borderRadius: 10, marginBottom: 16,
        background: featureEnabled ? 'rgba(34,197,94,0.10)' : 'var(--surface2, #334155)',
        border: `1px solid ${featureEnabled ? 'rgba(34,197,94,0.35)' : 'var(--border, #475569)'}`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
            {t('prio.feature.title')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3, #94a3b8)', marginTop: 2 }}>
            {featureEnabled ? t('prio.feature.onHelp') : t('prio.feature.offHelp')}
          </div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: busy ? 'wait' : 'pointer' }}>
          <input
            type="checkbox"
            checked={featureEnabled}
            disabled={busy}
            onChange={(e) => toggleFeature(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{
            position: 'absolute', inset: 0, borderRadius: 999,
            background: featureEnabled ? '#22c55e' : 'var(--border, #475569)',
            transition: 'background 0.2s',
          }} />
          <span style={{
            position: 'absolute', top: 2, left: featureEnabled ? 22 : 2,
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            transition: 'left 0.2s',
          }} />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, opacity: featureEnabled ? 1 : 0.5 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
            {t('prio.title')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 2 }}>
            {t('prio.subtitle')}
          </div>
        </div>
        <button type="button" onClick={openCreate} style={btnPrimary} disabled={!featureEnabled}>+ {t('prio.add')}</button>
      </div>

      {error && (
        <div style={{ padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3, #64748b)', fontSize: 12 }}>
          {t('prio.loading')}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', border: '1px dashed var(--border, #475569)', borderRadius: 10, background: 'var(--surface2, #334155)' }}>
          <div style={{ fontSize: 13, color: 'var(--text, #f1f5f9)', marginBottom: 6 }}>
            {t('prio.empty.title')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginBottom: 12 }}>
            {t('prio.empty.sub')}
          </div>
          <button type="button" onClick={seedPresets} disabled={!canSeed || busy} style={btnPrimary}>
            {t('prio.seedDefaults')}
          </button>
        </div>
      ) : (
        <div>
          {items.map((p) => (
            <div key={p.id} style={cardStyle}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: (p.color ?? '#6b7280') + '33',
                border: `2px solid ${p.color ?? '#6b7280'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>{p.icon ?? '⭐'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 2 }}>
                  {t('prio.field.weight')}: {p.weight ?? 0}
                  {p.is_active === false ? ` · ${t('prio.disabled')}` : ''}
                </div>
              </div>
              <button type="button" onClick={() => openEdit(p)} style={btnGhost}>{t('prio.edit')}</button>
              <button type="button" onClick={() => remove(p)} style={btnDanger} disabled={busy}>{t('prio.delete')}</button>
            </div>
          ))}
        </div>
      )}

      {/* Edit / Create modal */}
      {modalOpen && (
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 440, maxWidth: '92%', background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #475569)', borderRadius: 12, padding: 20, maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #f1f5f9)', marginBottom: 12 }}>
              {editing ? t('prio.modal.edit') : t('prio.modal.new')}
            </div>

            {/* Preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--surface2, #334155)', borderRadius: 10, marginBottom: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8,
                background: draft.color + '33',
                border: `2px solid ${draft.color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
              }}>{draft.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>
                {draft.name || t('prio.field.name')}
              </div>
            </div>

            <label style={labelStyle}>{t('prio.field.name')}</label>
            <input
              style={{ ...inputStyle, marginBottom: 12 }}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t('prio.field.name.placeholder')}
              autoFocus
            />

            <label style={labelStyle}>{t('prio.field.icon')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {PRESET_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, icon: ic }))}
                  style={{
                    width: 36, height: 36, borderRadius: 8, fontSize: 18, cursor: 'pointer',
                    background: draft.icon === ic ? 'var(--primary, #3b82f6)' : 'var(--surface2, #334155)',
                    border: '1px solid var(--border, #475569)',
                  }}
                >{ic}</button>
              ))}
            </div>

            <label style={labelStyle}>{t('prio.field.color')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, color: c }))}
                  style={{
                    width: 28, height: 28, borderRadius: 8, cursor: 'pointer',
                    background: c,
                    border: draft.color === c ? '3px solid var(--text, #f1f5f9)' : '1px solid var(--border, #475569)',
                  }}
                  aria-label={c}
                />
              ))}
            </div>

            <label style={labelStyle}>{t('prio.field.weightHelp')}</label>
            <input
              type="number"
              style={{ ...inputStyle, marginBottom: 12 }}
              value={draft.weight}
              min={0}
              max={100}
              onChange={(e) => setDraft((d) => ({ ...d, weight: Number(e.target.value) || 0 }))}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text, #f1f5f9)', marginBottom: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))}
              />
              {t('prio.field.activeHelp')}
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={close} style={btnGhost} disabled={busy}>{t('prio.cancel')}</button>
              <button type="button" onClick={save} style={btnPrimary} disabled={busy}>
                {busy ? t('prio.saving') : editing ? t('prio.save') : t('prio.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
