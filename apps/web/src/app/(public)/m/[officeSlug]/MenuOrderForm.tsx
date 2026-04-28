'use client';

import { useMemo, useState } from 'react';
import {
  validatePlaceOrderRequest,
  type CartItem,
  type DeliveryAddress,
  type OrderServiceMode,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
} from '@qflo/shared';

interface MenuItemRow {
  id: string;
  name: string;
  price: number;
  category_id: string;
  prep_time_minutes: number | null;
  image_url: string | null;
}

interface CategoryRow { id: string; name: string }

export interface MenuOrderFormProps {
  office: { id: string; slug: string; name: string };
  organization: { id: string; name: string; country: string | null };
  offered: OrderServiceMode[];
  categories: CategoryRow[];
  items: MenuItemRow[];
  currency: string;
  prefillPhone: string;
  initialService: OrderServiceMode | null;
}

// Format money with 2 decimals — Algerian dinar pattern (per the codebase
// rule about always rendering 2 decimals so the cents don't disappear).
function fmt(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

export function MenuOrderForm({
  office,
  offered,
  categories,
  items,
  currency,
  prefillPhone,
  initialService,
}: MenuOrderFormProps) {
  // Fall back to the only offered service if there's just one — saves a tap.
  const [service, setService] = useState<OrderServiceMode | null>(
    initialService && offered.includes(initialService)
      ? initialService
      : offered.length === 1
        ? offered[0]
        : null,
  );

  // Cart keyed by menu_item_id. Qty 0 == removed.
  const [cart, setCart] = useState<Record<string, { qty: number; note: string }>>({});

  // Customer + address fields.
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(prefillPhone);
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [instructions, setInstructions] = useState('');
  const [orderNote, setOrderNote] = useState('');

  // UI state.
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<PlaceOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group items by category in original sort order.
  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItemRow[]>();
    for (const c of categories) map.set(c.id, []);
    for (const it of items) {
      const list = map.get(it.category_id);
      if (list) list.push(it);
    }
    // Drop empty categories so the page doesn't show a "Drinks" header with no items.
    return categories.filter((c) => (map.get(c.id)?.length ?? 0) > 0).map((c) => ({
      ...c,
      items: map.get(c.id) ?? [],
    }));
  }, [categories, items]);

  const cartLines = useMemo<CartItem[]>(() => {
    return Object.entries(cart)
      .filter(([, v]) => v.qty > 0)
      .map(([id, v]) => {
        const it = items.find((x) => x.id === id);
        return {
          menu_item_id: id,
          name: it?.name ?? '',
          unit_price: it?.price ?? 0,
          qty: v.qty,
          note: v.note?.trim() || null,
        };
      });
  }, [cart, items]);

  const subtotal = useMemo(
    () => cartLines.reduce((s, l) => s + l.unit_price * l.qty, 0),
    [cartLines],
  );

  const setQty = (id: string, qty: number) => {
    setCart((prev) => ({
      ...prev,
      [id]: { qty: Math.max(0, Math.min(99, qty)), note: prev[id]?.note ?? '' },
    }));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!service) {
      setError('Please choose Takeout or Delivery.');
      return;
    }
    const delivery_address: DeliveryAddress | null =
      service === 'delivery'
        ? { street: street.trim(), city: city.trim() || null, instructions: instructions.trim() || null }
        : null;

    const req: PlaceOrderRequest = {
      office_slug: office.slug,
      service,
      channel: prefillPhone ? 'whatsapp' : 'web',
      locale: 'fr',
      customer: { name: name.trim(), phone: phone.trim(), notes: orderNote.trim() || null },
      items: cartLines,
      delivery_address,
    };
    const v = validatePlaceOrderRequest(req);
    if (v) { setError(v.message); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/orders/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? `Order failed (HTTP ${res.status})`);
        return;
      }
      setConfirmation(body as PlaceOrderResponse);
    } catch (e: any) {
      setError(e?.message ?? 'Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Confirmation screen ───────────────────────────────────────────
  if (confirmation) {
    return (
      <main style={pageWrap}>
        <div style={{ ...card, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>✓</div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Order received</h1>
          <p style={{ color: '#64748b', marginTop: 8 }}>
            {office.name} has received your order. You&apos;ll be notified when it&apos;s confirmed.
          </p>
          <div style={{ ...numberPill, marginTop: 16 }}>{confirmation.ticket_number}</div>
          <dl style={{ marginTop: 24, textAlign: 'start' }}>
            <Row label="Total">{fmt(confirmation.total, confirmation.currency)}</Row>
            <Row label="Payment">Unpaid — pay on {service === 'delivery' ? 'delivery' : 'pickup'}</Row>
            <Row label="ETA">~{confirmation.eta_minutes} min after acceptance</Row>
          </dl>
          <a
            href={confirmation.track_url}
            style={{ ...primaryBtn, display: 'inline-block', marginTop: 16, textDecoration: 'none' }}
          >
            Track your order
          </a>
        </div>
      </main>
    );
  }

  // ── Service picker (shown when more than one mode is offered) ─────
  if (!service) {
    return (
      <main style={pageWrap}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{office.name}</h1>
          <p style={{ color: '#64748b', marginTop: 4 }}>How would you like to order?</p>
        </header>
        <div style={{ display: 'grid', gap: 12 }}>
          {offered.includes('takeout') && (
            <ServiceCard
              icon="🛍️"
              title="Takeout"
              subtitle="Pick up from the restaurant"
              onClick={() => setService('takeout')}
            />
          )}
          {offered.includes('delivery') && (
            <ServiceCard
              icon="🛵"
              title="Delivery"
              subtitle="We deliver to your address"
              onClick={() => setService('delivery')}
            />
          )}
        </div>
      </main>
    );
  }

  // ── Menu + cart ────────────────────────────────────────────────────
  return (
    <main style={pageWrap}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setService(null)}
          style={{ ...iconBtn }}
          aria-label="Change order type"
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>{office.name}</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
            {service === 'delivery' ? 'Delivery order' : 'Takeout order'}
          </p>
        </div>
      </header>

      {itemsByCategory.map((cat) => (
        <section key={cat.id} style={{ ...card, marginBottom: 12, padding: 12 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 14, color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {cat.name}
          </h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {cat.items.map((it) => {
              const qty = cart[it.id]?.qty ?? 0;
              return (
                <li key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBlockEnd: '1px solid #f1f5f9' }}>
                  {it.image_url && (
                    <img
                      src={it.image_url}
                      alt=""
                      width={48}
                      height={48}
                      style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{it.name}</div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      <span>{fmt(it.price, currency)}</span>
                      {it.prep_time_minutes != null && it.prep_time_minutes > 0 && (
                        <span>· {it.prep_time_minutes} min</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {qty > 0 && (
                      <>
                        <button type="button" style={iconBtn} onClick={() => setQty(it.id, qty - 1)} aria-label="Decrease">−</button>
                        <span style={{ minWidth: 18, textAlign: 'center', fontWeight: 700 }}>{qty}</span>
                      </>
                    )}
                    <button
                      type="button"
                      style={{ ...iconBtn, background: '#6366f1', color: '#fff', borderColor: '#6366f1' }}
                      onClick={() => setQty(it.id, qty + 1)}
                      aria-label="Add"
                    >
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* Customer details — kept compact, only shown after at least one item is in the cart */}
      {cartLines.length > 0 && (
        <section style={{ ...card, padding: 16, marginBottom: 12 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14 }}>Your details</h2>
          <Field label="Name">
            <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Phone">
            <input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0X XX XX XX XX" inputMode="tel" />
          </Field>
          {service === 'delivery' && (
            <>
              <Field label="Street">
                <input style={input} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Street and number" />
              </Field>
              <Field label="City / commune">
                <input style={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Driver instructions">
                <input style={input} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Floor, building, ring twice…" />
              </Field>
            </>
          )}
          <Field label="Order notes">
            <input style={input} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} placeholder="Allergies, special requests…" />
          </Field>
        </section>
      )}

      {/* Sticky cart bar */}
      {cartLines.length > 0 && (
        <div style={stickyBar}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{cartLines.reduce((s, l) => s + l.qty, 0)} items</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{fmt(subtotal, currency)}</div>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            style={{ ...primaryBtn, opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? 'Sending…' : 'Place order'}
          </button>
        </div>
      )}

      {error && (
        <div style={{
          position: 'fixed', insetInlineStart: 12, insetInlineEnd: 12, bottom: 90,
          background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          {error}
        </div>
      )}
    </main>
  );
}

// ── Tiny presentational helpers ────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBlockEnd: '1px solid #f1f5f9' }}>
      <dt style={{ color: '#64748b', fontSize: 13 }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{children}</dd>
    </div>
  );
}

function ServiceCard({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...card, padding: 16, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'start' }}>
      <span style={{ fontSize: 28 }}>{icon}</span>
      <span>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 16 }}>{title}</span>
        <span style={{ display: 'block', color: '#64748b', fontSize: 13 }}>{subtitle}</span>
      </span>
    </button>
  );
}

// ── Inline styles (small page; styling in shared CSS would be over-engineering)
const pageWrap: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto', padding: '16px 12px 110px',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  color: '#0f172a', background: '#f8fafc', minHeight: '100vh',
};

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
};

const numberPill: React.CSSProperties = {
  display: 'inline-block', padding: '8px 18px', borderRadius: 999,
  background: '#eef2ff', color: '#4338ca', fontWeight: 800, fontSize: 22, letterSpacing: 1,
};

const iconBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff',
  cursor: 'pointer', fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 0,
};

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px',
  borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14, background: '#fff', color: '#0f172a',
};

const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 8, border: 'none',
  background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
};

const stickyBar: React.CSSProperties = {
  position: 'fixed', insetInlineStart: 0, insetInlineEnd: 0, bottom: 0,
  background: '#fff', borderBlockStart: '1px solid #e2e8f0',
  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
  boxShadow: '0 -8px 16px rgba(0,0,0,0.04)',
};
