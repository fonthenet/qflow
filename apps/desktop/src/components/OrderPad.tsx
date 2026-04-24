import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { formatMoney } from '../lib/money';

// ── Order pad ─────────────────────────────────────────────────────
// Full-screen modal for taking orders on a seated ticket. Category
// tabs across the top, item tiles below, a running tally on the right
// rail. Inspired by Toast / Square / Lightspeed — big touch targets,
// live total, per-line qty + note.
//
// Writes go through window.qf.ticketItems (local SQLite + sync queue),
// so this works offline and converges once the Station is back online.

export interface MenuCategory {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
  color?: string | null;
  icon?: string | null;
  active: 0 | 1 | boolean;
}

export interface MenuItem {
  id: string;
  organization_id: string;
  category_id: string;
  name: string;
  price: number | null;
  discount_percent?: number;
  sort_order: number;
  active: 0 | 1 | boolean;
}

export interface TicketItem {
  id: string;
  ticket_id: string;
  organization_id: string;
  menu_item_id: string | null;
  name: string;
  price: number | null;
  qty: number;
  note: string | null;
  added_at: string;
}

interface Props {
  orgId: string;
  staffId: string | null;
  ticketId: string;
  ticketNumber: string;
  tableCode?: string | null;
  locale: DesktopLocale;
  currency?: string;
  decimals?: number;
  onClose: () => void;
  onChanged?: () => void;
}

export function OrderPad({ orgId, staffId, ticketId, ticketNumber, tableCode, locale, currency = '', decimals = 2, onClose, onChanged }: Props) {
  const t = useCallback((k: string, v?: Record<string, any>) => translate(locale, k, v), [locale]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [ticketItems, setTicketItems] = useState<TicketItem[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ id: string; value: string } | null>(null);

  const loadMenu = useCallback(async () => {
    try {
      const [cats, its] = await Promise.all([
        (window as any).qf.menu.listCategories(orgId),
        (window as any).qf.menu.listItems(orgId),
      ]);
      const catsArr: MenuCategory[] = Array.isArray(cats) ? cats : [];
      const itsArr: MenuItem[] = Array.isArray(its) ? its : [];
      setCategories(catsArr);
      setItems(itsArr);
      if (catsArr.length && !activeCat) setActiveCat(catsArr[0].id);
    } catch (err) {
      console.warn('[OrderPad] loadMenu failed', err);
    }
  }, [orgId, activeCat]);

  const loadTicketItems = useCallback(async () => {
    try {
      const rows = await (window as any).qf.ticketItems.list(ticketId);
      setTicketItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.warn('[OrderPad] loadTicketItems failed', err);
    }
  }, [ticketId]);

  useEffect(() => { loadMenu(); }, [loadMenu]);
  useEffect(() => { loadTicketItems(); }, [loadTicketItems]);

  // Refresh on sync-driven ticket changes
  useEffect(() => {
    const unsub = (window as any).qf?.tickets?.onChange?.(() => loadTicketItems());
    return () => { try { unsub?.(); } catch { /* */ } };
  }, [loadTicketItems]);

  const byCat = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const i of items) {
      if (!map.has(i.category_id)) map.set(i.category_id, []);
      map.get(i.category_id)!.push(i);
    }
    return map;
  }, [items]);

  const itemsForActive = activeCat ? (byCat.get(activeCat) ?? []) : [];

  const total = useMemo(() => {
    let t = 0;
    for (const ti of ticketItems) {
      if (ti.price != null) t += ti.price * ti.qty;
    }
    return t;
  }, [ticketItems]);
  const totalCount = useMemo(() => ticketItems.reduce((s, ti) => s + ti.qty, 0), [ticketItems]);

  const addItem = async (item: MenuItem) => {
    // Stack same-item-no-note lines by incrementing qty — matches Toast/Square behavior
    const existing = ticketItems.find((ti) => ti.menu_item_id === item.id && !ti.note);
    setBusy(item.id);
    try {
      if (existing) {
        await (window as any).qf.ticketItems.update(orgId, existing.id, { qty: existing.qty + 1 });
      } else {
        const dp = Number(item.discount_percent ?? 0);
        const unitPrice = item.price != null && dp > 0
          ? Math.round(item.price * (1 - dp / 100) * 100) / 100
          : item.price;
        await (window as any).qf.ticketItems.add(orgId, ticketId, {
          menu_item_id: item.id,
          name: item.name,
          price: unitPrice,
          qty: 1,
          added_by: staffId ?? null,
        });
      }
      await loadTicketItems();
      onChanged?.();
    } finally { setBusy(null); }
  };

  const updateQty = async (id: string, nextQty: number) => {
    if (nextQty < 1) return removeItem(id);
    setBusy(id);
    try {
      await (window as any).qf.ticketItems.update(orgId, id, { qty: nextQty });
      await loadTicketItems();
      onChanged?.();
    } finally { setBusy(null); }
  };

  const removeItem = async (id: string) => {
    setBusy(id);
    try {
      await (window as any).qf.ticketItems.delete(orgId, id);
      await loadTicketItems();
      onChanged?.();
    } finally { setBusy(null); }
  };

  const saveNote = async (id: string, value: string) => {
    setBusy(id);
    try {
      await (window as any).qf.ticketItems.update(orgId, id, { note: value.trim() || null });
      await loadTicketItems();
      setNoteEdit(null);
      onChanged?.();
    } finally { setBusy(null); }
  };

  const fmt = (n: number) => formatMoney(n, currency, decimals);

  return createPortal(
    <div style={backdrop} onClick={onClose}>
      <div style={shell} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={header}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('Order')} · {ticketNumber}{tableCode ? ` · ${tableCode}` : ''}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{t('Menu')}</div>
          </div>
          <button onClick={onClose} style={closeBtn} title={t('Close')}>✕</button>
        </div>

        {/* Body: categories | items | cart */}
        <div style={body}>
          {/* Categories rail */}
          <div style={catRail}>
            {categories.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
                {t('No menu yet. Open Settings → Menu to add categories and items.')}
              </div>
            )}
            {categories.map((c) => {
              const isActive = c.id === activeCat;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveCat(c.id)}
                  style={{
                    ...catBtn,
                    background: isActive ? (c.color || '#3b82f6') : 'var(--surface)',
                    color: isActive ? '#fff' : 'var(--text)',
                    borderColor: isActive ? (c.color || '#3b82f6') : 'var(--border)',
                  }}
                >
                  {c.icon && <span style={{ marginRight: 6 }}>{c.icon}</span>}
                  {c.name}
                </button>
              );
            })}
          </div>

          {/* Item grid */}
          <div style={itemGrid}>
            {itemsForActive.length === 0 && categories.length > 0 && (
              <div style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', color: 'var(--text3)' }}>
                {t('No items in this category yet.')}
              </div>
            )}
            {itemsForActive.map((it) => (
              <button
                key={it.id}
                onClick={() => addItem(it)}
                disabled={busy === it.id}
                style={itemTile}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = ''; }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{it.name}</div>
                {it.price != null && (() => {
                  const dp = Number(it.discount_percent ?? 0);
                  if (dp > 0) {
                    const final = it.price * (1 - dp / 100);
                    return (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)', textDecoration: 'line-through' }}>{fmt(it.price)}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>{fmt(final)}</span>
                        <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#ef4444', color: '#fff', fontWeight: 800 }}>-{dp}%</span>
                      </div>
                    );
                  }
                  return (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{fmt(it.price)}</div>
                  );
                })()}
              </button>
            ))}
          </div>

          {/* Cart / running order */}
          <div style={cart}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('Order')}</span>
              <span style={{ color: 'var(--text3)', fontWeight: 600 }}>{totalCount} {totalCount === 1 ? t('item') : t('items')}</span>
            </div>

            <div style={cartList}>
              {ticketItems.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                  {t('Tap items on the left to add them.')}
                </div>
              )}
              {ticketItems.map((ti) => {
                const editing = noteEdit?.id === ti.id;
                return (
                  <div key={ti.id} style={cartRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ti.name}
                      </div>
                      {ti.price != null && (
                        <div style={{ fontSize: 11, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(ti.price)} × {ti.qty} = <strong style={{ color: 'var(--text)' }}>{fmt(ti.price * ti.qty)}</strong>
                        </div>
                      )}
                      {!editing && ti.note && (
                        <div
                          style={{ fontSize: 11, fontStyle: 'italic', color: '#fbbf24', marginTop: 2, cursor: 'pointer' }}
                          onClick={() => setNoteEdit({ id: ti.id, value: ti.note || '' })}
                        >
                          📝 {ti.note}
                        </div>
                      )}
                      {editing && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <input
                            autoFocus
                            value={noteEdit.value}
                            onChange={(e) => setNoteEdit({ id: ti.id, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveNote(ti.id, noteEdit.value);
                              if (e.key === 'Escape') setNoteEdit(null);
                            }}
                            placeholder={t('Note (e.g. no onions)')}
                            style={noteInput}
                          />
                          <button onClick={() => saveNote(ti.id, noteEdit.value)} style={noteSaveBtn}>✓</button>
                        </div>
                      )}
                      {!editing && !ti.note && (
                        <button
                          onClick={() => setNoteEdit({ id: ti.id, value: '' })}
                          style={{ fontSize: 10, color: 'var(--text3)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}
                        >
                          + {t('Add note')}
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => updateQty(ti.id, ti.qty - 1)} disabled={busy === ti.id} style={qtyBtn}>−</button>
                      <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 800, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{ti.qty}</span>
                      <button onClick={() => updateQty(ti.id, ti.qty + 1)} disabled={busy === ti.id} style={qtyBtn}>+</button>
                      <button onClick={() => removeItem(ti.id)} disabled={busy === ti.id} style={{ ...qtyBtn, marginLeft: 4, color: '#fca5a5' }} title={t('Remove')}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={cartFooter}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 700 }}>{t('Total')}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(total)}
                </span>
              </div>
              <button onClick={onClose} style={doneBtn}>{t('Done')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Styles ────────────────────────────────────────────────────────
const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 10000,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20,
};
const shell: React.CSSProperties = {
  width: '100%', height: '100%', maxWidth: 1400, maxHeight: 900,
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
  flex: 1, display: 'grid', gridTemplateColumns: '180px 1fr 340px', minHeight: 0,
};
const catRail: React.CSSProperties = {
  padding: 12, borderRight: '1px solid var(--border)', overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 6,
};
const catBtn: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 8, border: '1px solid',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
  transition: 'all 0.15s',
};
const itemGrid: React.CSSProperties = {
  padding: 16, overflowY: 'auto',
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 10, alignContent: 'start',
};
const itemTile: React.CSSProperties = {
  padding: 14, borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--surface)', cursor: 'pointer', textAlign: 'left',
  transition: 'all 0.15s', minHeight: 78,
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
};
const cart: React.CSSProperties = {
  borderLeft: '1px solid var(--border)', background: 'var(--surface)',
  display: 'flex', flexDirection: 'column', minHeight: 0,
  padding: 14,
};
const cartList: React.CSSProperties = {
  flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8,
};
const cartRow: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center',
  padding: 10, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)',
};
const qtyBtn: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text)', fontSize: 14, fontWeight: 800,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const noteInput: React.CSSProperties = {
  flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 11, colorScheme: 'light dark',
};
const noteSaveBtn: React.CSSProperties = {
  padding: '0 8px', borderRadius: 6, border: 'none',
  background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 12,
};
const cartFooter: React.CSSProperties = {
  borderTop: '1px solid var(--border)', paddingTop: 10,
  display: 'flex', flexDirection: 'column', gap: 10,
};
const doneBtn: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(59,130,246,0.3)',
};
