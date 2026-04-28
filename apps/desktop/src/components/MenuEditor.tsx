import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import type { MenuCategory, MenuItem } from './OrderPad';
import { formatMoney } from '../lib/money';

// ── Menu editor ───────────────────────────────────────────────────
// Admin-facing category + item editor. Categories rail on the left,
// items grid on the right. Inline add/edit/delete. Everything is
// soft-deleted (active = false) so historical ticket_items snapshots
// still resolve a parent category if needed.

interface Props {
  orgId: string;
  locale: DesktopLocale;
  currency?: string;
  decimals?: number;
  onClose?: () => void;
  /** When true, renders inline (for Settings tab) instead of a portal modal. */
  embedded?: boolean;
}

const CAT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#6366f1'];
const CAT_ICONS = ['🍽️', '🍕', '🍔', '🥗', '🍰', '🍷', '☕', '🍹', '🥤', '🍲', '🍝', '🍣', '🌮', '🍖'];

export function MenuEditor({ orgId, locale, currency = '', decimals = 2, onClose, embedded = false }: Props) {
  const t = useCallback((k: string, v?: Record<string, any>) => translate(locale, k, v), [locale]);
  const fmt = (n: number) => formatMoney(n, currency, decimals);
  const fmtNoCur = (n: number) => {
    // Strip the trailing symbol for inline contexts that render it
    // elsewhere. Dynamic regex so any country's symbol works.
    const full = formatMoney(n, currency, decimals);
    if (!currency) return full;
    const escaped = currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return full.replace(new RegExp(`\\s+${escaped}$`), '');
  };
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [editingCat, setEditingCat] = useState<{ id?: string; name: string; color: string; icon: string } | null>(null);
  const [editingItem, setEditingItem] = useState<{
    id?: string;
    category_id: string;
    name: string;
    price: string;
    discount_percent: string;
    /** Prep time in minutes — used to compute the ETA when an online order
     *  is accepted on Station. Empty string = no prep (drinks, desserts). */
    prep_time_minutes: string;
    /** Hides the item from the public ordering page without deleting it. */
    is_available: boolean;
    /** Optional photo URL displayed on the public menu page. */
    image_url: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cats, its] = await Promise.all([
      (window as any).qf.menu.listCategories(orgId),
      (window as any).qf.menu.listItems(orgId),
    ]);
    const catsArr: MenuCategory[] = Array.isArray(cats) ? cats : [];
    setCategories(catsArr);
    setItems(Array.isArray(its) ? its : []);
    if (catsArr.length && !activeCat) setActiveCat(catsArr[0].id);
  }, [orgId, activeCat]);

  useEffect(() => { load(); }, [load]);

  const itemsForActive = useMemo(
    () => items.filter((i) => i.category_id === activeCat),
    [items, activeCat]
  );

  const saveCat = async () => {
    if (!editingCat || !editingCat.name.trim()) return;
    setBusy(true);
    try {
      const nextSort = editingCat.id
        ? (categories.find((c) => c.id === editingCat.id)?.sort_order ?? 0)
        : categories.length;
      const res = await (window as any).qf.menu.upsertCategory(orgId, {
        id: editingCat.id,
        name: editingCat.name.trim(),
        color: editingCat.color,
        icon: editingCat.icon,
        sort_order: nextSort,
      });
      if (res?.id && !editingCat.id) setActiveCat(res.id);
      setEditingCat(null);
      await load();
    } finally { setBusy(false); }
  };

  const deleteCat = async (id: string) => {
    if (!confirm(t('Delete this category and all its items?'))) return;
    setBusy(true);
    try {
      await (window as any).qf.menu.deleteCategory(orgId, id);
      if (activeCat === id) setActiveCat(categories.find((c) => c.id !== id)?.id ?? null);
      await load();
    } finally { setBusy(false); }
  };

  const saveItem = async () => {
    if (!editingItem || !editingItem.name.trim() || !editingItem.category_id) return;
    setBusy(true);
    try {
      const nextSort = editingItem.id
        ? (items.find((i) => i.id === editingItem.id)?.sort_order ?? 0)
        : itemsForActive.length;
      await (window as any).qf.menu.upsertItem(orgId, {
        id: editingItem.id,
        category_id: editingItem.category_id,
        name: editingItem.name.trim(),
        price: editingItem.price === '' ? null : Number(editingItem.price),
        discount_percent: editingItem.discount_percent === '' ? 0 : Math.max(0, Math.min(100, Math.round(Number(editingItem.discount_percent)))),
        prep_time_minutes: editingItem.prep_time_minutes === '' ? null : Math.max(0, Math.min(180, Math.round(Number(editingItem.prep_time_minutes)))),
        is_available: editingItem.is_available,
        image_url: editingItem.image_url.trim() || null,
        sort_order: nextSort,
      });
      setEditingItem(null);
      await load();
    } finally { setBusy(false); }
  };

  // ── Starter menu seed ─────────────────────────────────────────
  // Drops a small French-restaurant starter menu so the operator
  // isn't staring at a blank editor on first run. They can edit,
  // delete, or start over — the seed is one-shot (only offered
  // when there are no categories yet).
  const seedStarterMenu = async () => {
    if (categories.length > 0) return;
    setBusy(true);
    try {
      const starter: Array<{ name: string; icon: string; color: string; items: Array<{ name: string; price: number | null }> }> = [
        { name: 'Entrées', icon: '🥗', color: '#22c55e', items: [
          { name: 'Salade mixte', price: 400 },
          { name: 'Chorba', price: 300 },
          { name: 'Brick à l\u2019œuf', price: 250 },
        ]},
        { name: 'Plats', icon: '🍽️', color: '#ef4444', items: [
          { name: 'Couscous royal', price: 1200 },
          { name: 'Tajine poulet', price: 1000 },
          { name: 'Grillade mixte', price: 1400 },
          { name: 'Rechta', price: 900 },
        ]},
        { name: 'Boissons', icon: '🥤', color: '#3b82f6', items: [
          { name: 'Eau minérale', price: 80 },
          { name: 'Soda', price: 150 },
          { name: 'Jus d\u2019orange', price: 250 },
          { name: 'Thé à la menthe', price: 200 },
          { name: 'Café', price: 100 },
        ]},
        { name: 'Desserts', icon: '🍰', color: '#f59e0b', items: [
          { name: 'Makroud', price: 200 },
          { name: 'Crème caramel', price: 300 },
          { name: 'Salade de fruits', price: 350 },
        ]},
      ];
      for (let c = 0; c < starter.length; c++) {
        const cat = starter[c];
        const res = await (window as any).qf.menu.upsertCategory(orgId, {
          name: cat.name, icon: cat.icon, color: cat.color, sort_order: c,
        });
        const catId: string = res?.id;
        if (!catId) continue;
        for (let i = 0; i < cat.items.length; i++) {
          const it = cat.items[i];
          await (window as any).qf.menu.upsertItem(orgId, {
            category_id: catId, name: it.name, price: it.price, sort_order: i,
          });
        }
      }
      await load();
    } finally { setBusy(false); }
  };

  const deleteItem = async (id: string) => {
    if (!confirm(t('Delete this item?'))) return;
    setBusy(true);
    try {
      await (window as any).qf.menu.deleteItem(orgId, id);
      await load();
    } finally { setBusy(false); }
  };

  const content = (
    <>
      {!embedded && (
        <div style={header}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Settings')}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>🍽️ {t('Menu')}</div>
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
      )}

        <div style={embedded ? { ...body, height: '100%' } : body}>
          {/* Categories rail */}
          <div style={catRail}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text3)' }}>
                {t('Categories')} ({categories.length})
              </div>
              <button
                onClick={() => setEditingCat({ name: '', color: CAT_COLORS[categories.length % CAT_COLORS.length], icon: CAT_ICONS[0] })}
                style={addBtn}
                title={t('Add category')}
              >+</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {categories.map((c) => {
                const isActive = c.id === activeCat;
                const count = items.filter((i) => i.category_id === c.id).length;
                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    style={{
                      ...catRow,
                      background: isActive ? (c.color || '#3b82f6') : 'var(--surface)',
                      color: isActive ? '#fff' : 'var(--text)',
                      borderColor: isActive ? (c.color || '#3b82f6') : 'var(--border)',
                    }}
                  >
                    <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {c.icon && <span>{c.icon}</span>}
                      <span style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{count}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingCat({ id: c.id, name: c.name, color: c.color || CAT_COLORS[0], icon: c.icon || CAT_ICONS[0] }); }}
                      style={iconBtn(isActive)}
                      title={t('Edit')}
                    >✎</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCat(c.id); }}
                      style={iconBtn(isActive)}
                      title={t('Delete')}
                    >🗑</button>
                  </div>
                );
              })}
              {categories.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
                  {t('No categories yet. Tap + to add one.')}
                  <button
                    onClick={seedStarterMenu}
                    disabled={busy}
                    style={{ ...primaryBtn, display: 'block', margin: '12px auto 0' }}
                  >
                    ✨ {t('Load starter menu')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Items pane */}
          <div style={itemPane}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {activeCat ? (categories.find((c) => c.id === activeCat)?.name ?? '') : t('Select a category')}
              </div>
              {activeCat && (
                <button
                  onClick={() => setEditingItem({ category_id: activeCat, name: '', price: '', discount_percent: '', prep_time_minutes: '', is_available: true, image_url: '' })}
                  style={primaryBtn}
                >
                  + {t('Add item')}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {itemsForActive.map((it) => (
                <div key={it.id} style={itemRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{it.name}</div>
                    {it.price != null && (() => {
                      const dp = Number((it as any).discount_percent ?? 0);
                      if (dp > 0) {
                        const final = it.price * (1 - dp / 100);
                        return (
                          <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: 'var(--text3)', textDecoration: 'line-through', fontWeight: 500 }}>
                              {fmtNoCur(it.price)}
                            </span>
                            <span style={{ color: '#22c55e' }}>
                              {fmt(final)}
                            </span>
                            <span style={{
                              fontSize: 10, padding: '1px 5px', borderRadius: 4,
                              background: '#ef4444', color: '#fff', fontWeight: 800,
                            }}>-{dp}%</span>
                          </div>
                        );
                      }
                      return (
                        <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(it.price)}
                        </div>
                      );
                    })()}
                  </div>
                  <button
                    onClick={() => setEditingItem({
                      id: it.id,
                      category_id: it.category_id,
                      name: it.name,
                      price: it.price?.toString() ?? '',
                      discount_percent: (it as any).discount_percent ? String((it as any).discount_percent) : '',
                      prep_time_minutes: (it as any).prep_time_minutes != null ? String((it as any).prep_time_minutes) : '',
                      is_available: (it as any).is_available !== false,
                      image_url: (it as any).image_url ?? '',
                    })}
                    style={iconBtn(false)}
                  >✎</button>
                  <button
                    onClick={() => deleteItem(it.id)}
                    style={iconBtn(false)}
                  >🗑</button>
                </div>
              ))}
              {activeCat && itemsForActive.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  {t('No items yet. Tap Add item to create one.')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Category editor */}
        {editingCat && (
          <div style={subBackdrop} onClick={() => setEditingCat(null)}>
            <div style={subModal} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
                {editingCat.id ? t('Edit category') : t('Add category')}
              </div>
              <label style={fieldLabel}>{t('Name')}</label>
              <input
                autoFocus
                value={editingCat.name}
                onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCat(); }}
                placeholder={t('e.g. Entrées')}
                style={inputStyle}
              />
              <label style={fieldLabel}>{t('Icon')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {CAT_ICONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setEditingCat({ ...editingCat, icon: ic })}
                    style={{
                      ...swatchBtn,
                      fontSize: 18,
                      borderColor: editingCat.icon === ic ? '#3b82f6' : 'var(--border)',
                      background: editingCat.icon === ic ? 'rgba(59,130,246,0.15)' : 'var(--surface)',
                    }}
                  >{ic}</button>
                ))}
              </div>
              <label style={fieldLabel}>{t('Color')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {CAT_COLORS.map((col) => (
                  <button
                    key={col}
                    onClick={() => setEditingCat({ ...editingCat, color: col })}
                    style={{
                      ...swatchBtn, background: col, width: 32, height: 32,
                      borderColor: editingCat.color === col ? '#fff' : 'transparent',
                      boxShadow: editingCat.color === col ? `0 0 0 2px ${col}` : 'none',
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setEditingCat(null)} style={ghostBtn}>{t('Cancel')}</button>
                <button onClick={saveCat} disabled={busy || !editingCat.name.trim()} style={primaryBtn}>{t('Save')}</button>
              </div>
            </div>
          </div>
        )}

        {/* Item editor */}
        {editingItem && (
          <div style={subBackdrop} onClick={() => setEditingItem(null)}>
            <div style={subModal} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
                {editingItem.id ? t('Edit item') : t('Add item')}
              </div>
              <label style={fieldLabel}>{t('Name')}</label>
              <input
                autoFocus
                value={editingItem.name}
                onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveItem(); }}
                placeholder={t('e.g. Couscous royal')}
                style={inputStyle}
              />
              <label style={fieldLabel}>{t('Price ({currency}) — optional', { currency })}</label>
              <input
                value={editingItem.price}
                onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value.replace(/[^0-9.]/g, '') })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveItem(); }}
                placeholder="0"
                style={inputStyle}
                inputMode="decimal"
              />
              <label style={fieldLabel}>{t('Discount (%) — optional')}</label>
              <input
                value={editingItem.discount_percent}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '');
                  const clamped = v === '' ? '' : String(Math.min(100, parseInt(v, 10) || 0));
                  setEditingItem({ ...editingItem, discount_percent: clamped });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') saveItem(); }}
                placeholder="0"
                style={inputStyle}
                inputMode="numeric"
              />
              {(() => {
                const p = Number(editingItem.price);
                const d = Number(editingItem.discount_percent);
                if (!p || !d || d <= 0) return null;
                const final = p * (1 - d / 100);
                return (
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: -6, marginBottom: 4 }}>
                    <span style={{ textDecoration: 'line-through' }}>{fmtNoCur(p)}</span>
                    {' → '}
                    <span style={{ color: '#22c55e', fontWeight: 700 }}>{fmt(final)}</span>
                  </div>
                );
              })()}

              {/* Prep time — used only on the operator's Accept-modal ETA
                  estimate for online orders. Drinks / cold dishes can leave
                  it blank. Capped at 180 (anything longer is unrealistic). */}
              <label style={fieldLabel}>{t('Prep time (min) — optional')}</label>
              <input
                value={editingItem.prep_time_minutes}
                onChange={(e) => setEditingItem({ ...editingItem, prep_time_minutes: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveItem(); }}
                placeholder={t('e.g. 15')}
                style={inputStyle}
                inputMode="numeric"
              />

              {/* Image URL — shows alongside the item on /m/<slug>. */}
              <label style={fieldLabel}>{t('Image URL — optional')}</label>
              <input
                value={editingItem.image_url}
                onChange={(e) => setEditingItem({ ...editingItem, image_url: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveItem(); }}
                placeholder="https://..."
                style={inputStyle}
              />

              {/* Availability toggle — when off, the item is hidden from the
                  public ordering page without being deleted. Kitchen runs
                  out of an item: flip this off until it's back in stock. */}
              <label style={{ ...fieldLabel, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={editingItem.is_available}
                  onChange={(e) => setEditingItem({ ...editingItem, is_available: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: '#22c55e' }}
                />
                <span>{t('Available for online orders')}</span>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button onClick={() => setEditingItem(null)} style={ghostBtn}>{t('Cancel')}</button>
                <button onClick={saveItem} disabled={busy || !editingItem.name.trim()} style={primaryBtn}>{t('Save')}</button>
              </div>
            </div>
          </div>
        )}
    </>
  );

  if (embedded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {content}
      </div>
    );
  }

  return createPortal(
    <div style={backdrop} onClick={onClose}>
      <div style={shell} onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>,
    document.body
  );
}

// ── Styles ────────────────────────────────────────────────────────
const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9990,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const shell: React.CSSProperties = {
  width: '100%', maxWidth: 1100, height: '85%', maxHeight: 780,
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16,
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  boxShadow: '0 25px 60px rgba(0,0,0,0.45)',
};
const header: React.CSSProperties = {
  padding: '14px 20px', borderBottom: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  background: 'var(--surface)',
};
const closeBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text)', fontSize: 16, cursor: 'pointer',
};
const body: React.CSSProperties = {
  flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 0,
};
const catRail: React.CSSProperties = {
  padding: 12, borderRight: '1px solid var(--border)', overflowY: 'auto',
};
const catRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 10px', borderRadius: 8, border: '1px solid',
  cursor: 'pointer', transition: 'all 0.15s',
};
const itemPane: React.CSSProperties = {
  padding: 16, overflowY: 'auto',
};
const itemRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface)',
};
const addBtn: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer',
  fontSize: 14, fontWeight: 800,
};
const iconBtn = (invert: boolean): React.CSSProperties => ({
  width: 26, height: 26, borderRadius: 6, border: 'none',
  background: invert ? 'rgba(255,255,255,0.2)' : 'transparent',
  color: invert ? '#fff' : 'var(--text2)', cursor: 'pointer', fontSize: 12,
});
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none',
  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text2)', fontWeight: 600, fontSize: 12, cursor: 'pointer',
};
const subBackdrop: React.CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 20,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const subModal: React.CSSProperties = {
  width: '100%', maxWidth: 420,
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12,
  padding: 18, boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
};
const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: 0.5, color: 'var(--text3)', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', fontSize: 14,
  marginBottom: 12, colorScheme: 'light dark', boxSizing: 'border-box',
};
const swatchBtn: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 8, border: '2px solid',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
