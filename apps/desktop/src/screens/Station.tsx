import React, { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { getSupabase } from '../lib/supabase';
import type { StaffSession, Ticket } from '../lib/types';
import { formatDesktopTime, formatWaitLabel, t as translate, type DesktopLocale } from '../lib/i18n';

// ── Transfer Modal Component ──────────────────────────────────────
function TransferModal({ desks, onTransfer, onClose, locale }: {
  desks: [string, string][];
  onTransfer: (deskId: string, deskName: string) => void;
  onClose: () => void;
  locale: DesktopLocale;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);

  useEffect(() => {
    dialogRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label={t('Transfer ticket to another desk')}
        style={{
          background: 'var(--surface)', borderRadius: 12, padding: 24,
          minWidth: 320, maxWidth: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          outline: 'none',
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>{t('Transfer to Desk')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {desks.map(([id, name]) => (
            <button
              key={id}
              onClick={() => onTransfer(id, name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                color: 'var(--text)', textAlign: 'left', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            >
              <span style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                {name.charAt(0).toUpperCase()}
              </span>
              {name}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '10px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'transparent', color: 'var(--text2)',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          {t('Cancel')}
        </button>
      </div>
    </div>
  );
}

// ── In-House Booking Panel (docked at bottom of main area) ───────
function InHouseBookingPanel({ departments, services, officeId, onBook, locale, messengerPageId, whatsappPhone, onCollapse }: {
  departments: [string, string][]; // [id, name][]
  services: { id: string; name: string; department_id: string }[];
  officeId: string;
  onBook: (ticket: { department_id: string; service_id?: string; customer_data: { name?: string; phone?: string; reason?: string }; priority: number; source: string }) => Promise<any>;
  locale: DesktopLocale;
  messengerPageId?: string | null;
  whatsappPhone?: string | null;
  onCollapse: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);
  const [selectedDept, setSelectedDept] = useState(departments.length === 1 ? departments[0][0] : '');
  const [selectedService, setSelectedService] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerReason, setCustomerReason] = useState('');
  const [isPriority, setIsPriority] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdTicket, setCreatedTicket] = useState<{ id: string; ticket_number: string; qr_token: string } | null>(null);
  const [customerLookup, setCustomerLookup] = useState<{ visits: number; lastVisit: string; notes?: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<{ sent: boolean; error?: string } | null>(null);

  const deptServices = useMemo(() =>
    services.filter(s => s.department_id === selectedDept),
    [services, selectedDept]
  );

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  // Listen for ticket number rewrite after sync
  useEffect(() => {
    if (!createdTicket?.id) return;
    if (!createdTicket.ticket_number.startsWith('L-')) return;
    const checkRewrite = async () => {
      try {
        const fresh = await window.qf.db.getTickets([officeId], ['waiting', 'called', 'serving']);
        const updated = (fresh as any[]).find((t: any) => t.id === createdTicket.id);
        if (updated && updated.ticket_number !== createdTicket.ticket_number) {
          setCreatedTicket(prev => prev ? { ...prev, ticket_number: updated.ticket_number } : null);
        }
      } catch { /* ignore */ }
    };
    const unsub = window.qf.tickets.onChange(checkRewrite);
    const iv = setInterval(checkRewrite, 1000);
    return () => { unsub(); clearInterval(iv); };
  }, [createdTicket?.id, createdTicket?.ticket_number, officeId]);

  // Customer lookup when phone number is entered
  useEffect(() => {
    const phone = customerPhone.trim();
    if (phone.length < 6) { setCustomerLookup(null); return; }
    setLookupLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`http://localhost:8080/api/customer-lookup?phone=${encodeURIComponent(phone)}&orgId=${encodeURIComponent(officeId)}`, { signal: ctrl.signal })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.customer) setCustomerLookup({ visits: data.customer.visit_count, lastVisit: data.customer.last_visit_at, notes: data.customer.notes });
          else if (data?.visits) setCustomerLookup({ visits: data.visits, lastVisit: data.lastVisit, notes: data.notes });
          else setCustomerLookup(null);
        })
        .catch(() => setCustomerLookup(null))
        .finally(() => setLookupLoading(false));
    }, 500);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [customerPhone, officeId]);

  const handleSubmit = async () => {
    if (!selectedDept || submitting) return;
    setSubmitting(true);
    try {
      const result = await onBook({
        department_id: selectedDept,
        service_id: selectedService || undefined,
        customer_data: {
          name: customerName.trim() || undefined,
          phone: customerPhone.trim() || undefined,
          reason: customerReason.trim() || undefined,
        },
        priority: isPriority ? 2 : 0,
        source: 'in_house',
      });
      if (result?.ticket_number) {
        setCreatedTicket({ id: result.id, ticket_number: result.ticket_number, qr_token: result.qr_token });
        setWhatsappStatus(result.whatsappStatus ?? null);
      }
    } catch (err) {
      console.error('[booking-panel] handleSubmit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewTicket = () => {
    setCreatedTicket(null);
    setWhatsappStatus(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerReason('');
    setIsPriority(false);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const trackUrl = createdTicket ? `https://qflo.net/q/${createdTicket.qr_token}` : '';

  // Resizable panel height
  const [panelHeight, setPanelHeight] = useState(200);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;
    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      const delta = startYRef.current - ev.clientY;
      setPanelHeight(Math.max(100, Math.min(600, startHeightRef.current + delta)));
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [panelHeight]);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', border: '1px solid var(--border)',
    borderRadius: 6, background: 'var(--surface2)', color: 'var(--text)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 2 };

  return (
    <div
      className="booking-panel"
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        height: panelHeight, display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Resize handle */}
      <div
        onPointerDown={onResizeStart}
        style={{
          height: 6, cursor: 'ns-resize', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{ width: 40, height: 3, borderRadius: 2, background: 'var(--border)' }} />
      </div>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 16px 6px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 24, height: 24, borderRadius: 6,
            background: 'rgba(139,92,246,0.15)', color: '#8b5cf6',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700,
          }}>+</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{t('In-House Booking')}</span>
          <span style={{
            padding: '1px 6px', fontSize: 10, fontWeight: 600, borderRadius: 4,
            background: 'rgba(139,92,246,0.15)', color: '#8b5cf6',
          }}>F6</span>
        </div>
        <button
          onClick={onCollapse}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, padding: '2px 6px', borderRadius: 4 }}
          title={t('Hide')}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
      {createdTicket ? (
        /* ── Compact Confirmation ── */
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginBottom: 2 }}>✓ {t('Ticket Created')}</div>
              <div style={{
                fontSize: 22, fontWeight: 800, color: '#8b5cf6',
                background: 'rgba(139,92,246,0.1)', borderRadius: 8,
                padding: '6px 16px',
              }}>
                {createdTicket.ticket_number}
              </div>
              {customerName.trim() && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{customerName.trim()}</div>}
            </div>

            {whatsappStatus && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 6, fontSize: 11,
                background: whatsappStatus.sent ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                border: `1px solid ${whatsappStatus.sent ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
              }}>
                <span>{whatsappStatus.sent ? '\u2705' : '\u26A0\uFE0F'}</span>
                <span style={{ fontWeight: 600, color: whatsappStatus.sent ? '#16a34a' : '#d97706' }}>
                  {whatsappStatus.sent ? 'WhatsApp ✓' : 'WhatsApp ✗'}
                </span>
              </div>
            )}

            {/* QR + track link */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(trackUrl)}`}
                alt="QR" style={{ width: 56, height: 56, borderRadius: 6, border: '1px solid var(--border)' }}
              />
              <div style={{ fontSize: 10, color: 'var(--text3)', maxWidth: 140, wordBreak: 'break-all' }}>{trackUrl}</div>
            </div>

            {/* Messaging QRs - compact */}
            {whatsappPhone && createdTicket && (
              <div style={{ textAlign: 'center' }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`https://wa.me/${whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent('JOIN_' + createdTicket.qr_token)}`)}`}
                  alt="WA" style={{ width: 48, height: 48, borderRadius: 4, border: '1px solid var(--border)' }}
                />
                <div style={{ fontSize: 9, fontWeight: 600, color: '#25D366', marginTop: 2 }}>WhatsApp</div>
              </div>
            )}
            {messengerPageId && createdTicket && (
              <div style={{ textAlign: 'center' }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`https://m.me/${messengerPageId}?ref=JOIN_${createdTicket.qr_token}`)}`}
                  alt="Msg" style={{ width: 48, height: 48, borderRadius: 4, border: '1px solid var(--border)' }}
                />
                <div style={{ fontSize: 9, fontWeight: 600, color: '#0084FF', marginTop: 2 }}>Messenger</div>
              </div>
            )}

            <button
              onClick={handleNewTicket}
              style={{
                padding: '8px 16px', border: 'none', borderRadius: 6,
                background: '#8b5cf6', color: '#fff', cursor: 'pointer',
                fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
              }}
            >
              + {t('New Ticket')}
            </button>
          </div>
        </div>
      ) : (
        /* ── Compact Booking Form (2 rows) ── */
        <div style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {/* Row 1: Department + Service + Name + Phone */}
            <div style={{ flex: '1 1 130px', minWidth: 120 }}>
              <label style={labelStyle}>{t('Department')} *</label>
              <select
                value={selectedDept}
                onChange={(e) => { setSelectedDept(e.target.value); setSelectedService(''); }}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">{t('Select...')}</option>
                {departments.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>

            {selectedDept && deptServices.length > 0 && (
              <div style={{ flex: '1 1 120px', minWidth: 100 }}>
                <label style={labelStyle}>{t('Service')}</label>
                <select
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">{t('General')}</option>
                  {deptServices.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ flex: '1 1 130px', minWidth: 110 }}>
              <label style={labelStyle}>{t('Name')}</label>
              <input
                ref={nameRef}
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSubmit(); }}
                placeholder={t('Customer name')}
                style={inputStyle}
              />
            </div>

            <div style={{ flex: '1 1 120px', minWidth: 100 }}>
              <label style={labelStyle}>{t('Phone')}</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSubmit(); }}
                placeholder={t('Phone number')}
                style={inputStyle}
              />
            </div>

            <div style={{ flex: '1 1 130px', minWidth: 110 }}>
              <label style={labelStyle}>{t('Reason')}</label>
              <input
                type="text"
                value={customerReason}
                onChange={(e) => setCustomerReason(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSubmit(); }}
                placeholder={t('Reason for visit')}
                style={inputStyle}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', paddingBottom: 4 }}>
              <input type="checkbox" checked={isPriority} onChange={(e) => setIsPriority(e.target.checked)} style={{ width: 14, height: 14, accentColor: '#f59e0b' }} />
              {t('Priority')}
            </label>

            <button
              onClick={handleSubmit}
              disabled={!selectedDept || submitting}
              style={{
                padding: '7px 18px', border: 'none', borderRadius: 6,
                background: (selectedDept && !submitting) ? '#8b5cf6' : 'var(--surface2)',
                color: (selectedDept && !submitting) ? '#fff' : 'var(--text3)',
                cursor: (selectedDept && !submitting) ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
              }}
            >
              {submitting ? '...' : t('Create Ticket')}
            </button>
          </div>

          {/* Customer lookup inline */}
          {lookupLoading && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>{t('Looking up customer...')}</div>}
          {customerLookup && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 10px', borderRadius: 6, marginTop: 6,
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
              fontSize: 11, color: 'var(--text)',
            }}>
              <span style={{ fontWeight: 600 }}>
                {t('Returning customer')} &bull; {t('{count} visits', { count: customerLookup.visits })}
              </span>
              {customerLookup.notes && <span style={{ color: 'var(--text2)', fontStyle: 'italic' }}>{customerLookup.notes}</span>}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

declare global {
  interface Window {
    qf: any;
  }
}

interface Props {
  session: StaffSession;
  locale: DesktopLocale;
  isOnline: boolean;
  staffStatus: 'available' | 'on_break' | 'away';
  queuePaused: boolean;
  onStaffStatusChange: (status: 'available' | 'on_break' | 'away') => void;
  onQueuePausedChange: (paused: boolean) => void;
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    waiting: '#f59e0b', called: '#3b82f6', serving: '#22c55e',
    served: '#10b981', no_show: '#f97316', cancelled: '#ef4444',
  };
  return map[status] ?? '#64748b';
}

// ── Constants ────────────────────────────────────────────────────
const CALL_TIMEOUT = 60;
const FALLBACK_POLL_INTERVAL = 10000; // 10s fallback (event-driven is primary)
const DEVICE_CHECK_INTERVAL = 5000;

type StaffStatus = 'available' | 'on_break' | 'away';

const STAFF_STATUS_LABELS: Record<StaffStatus, { label: string; color: string; icon: string }> = {
  available: { label: 'Available', color: '#22c55e', icon: '●' },
  on_break: { label: 'On Break', color: '#f59e0b', icon: '◐' },
  away: { label: 'Away', color: '#ef4444', icon: '○' },
};

const DAYS_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeOfficeTimezone(timezone: string | null | undefined) {
  const value = (timezone ?? '').trim();
  if (!value) return 'UTC';
  if (value === 'Europe/Algiers') return 'Africa/Algiers';
  return value;
}

function getSafeElapsedSeconds(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function getTicketCustomerName(customerData: unknown) {
  if (!customerData || typeof customerData !== 'object' || Array.isArray(customerData)) {
    return null;
  }

  const data = customerData as Record<string, unknown>;
  const nameKeys = ['party_name', 'name', 'full_name', 'customer_name', 'patient_name', 'guest_name'] as const;

  for (const key of nameKeys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function formatLocalPhone(phone: string): string {
  // Algeria: strip leading +213 or 213 and prepend 0
  const stripped = phone.replace(/[\s\-()]/g, '');
  if (stripped.startsWith('+213')) return '0' + stripped.slice(4);
  if (stripped.startsWith('213') && stripped.length >= 12) return '0' + stripped.slice(3);
  return phone;
}

function getTicketCustomerPhone(customerData: unknown) {
  if (!customerData || typeof customerData !== 'object' || Array.isArray(customerData)) {
    return null;
  }

  const data = customerData as Record<string, unknown>;
  const phoneKeys = ['phone', 'mobile', 'telephone', 'cell', 'cell_phone', 'mobile_number', 'customer_phone'] as const;

  for (const key of phoneKeys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return formatLocalPhone(value.trim());
    }
  }

  return null;
}

function OfficeHoursBadge({ locale, session }: { locale: DesktopLocale; session: StaffSession }) {
  const [status, setStatus] = useState<{ isOpen: boolean; reason: string; todayHours: any; nextOpen?: any; currentDay: string } | null>(null);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);

  useEffect(() => {
    function check() {
      try {
        const officeIds = session.office_ids?.length ? session.office_ids : [session.office_id];
        const targetOfficeId = officeIds[0];
        if (!targetOfficeId) return;
        const offices = (window as any).qf?.db?.query?.(
          'SELECT operating_hours, timezone, settings FROM offices WHERE id = ? LIMIT 1',
          [targetOfficeId]
        );
        const office = offices?.[0];
        if (!office?.operating_hours && !office?.settings) return;
        const hours = typeof office.operating_hours === 'string' ? JSON.parse(office.operating_hours) : office.operating_hours;
        const settings = typeof office.settings === 'string' ? JSON.parse(office.settings) : office.settings ?? {};
        const overrideMode =
          typeof settings.visit_intake_override_mode === 'string'
            ? settings.visit_intake_override_mode
            : 'business_hours';
        const tz = normalizeOfficeTimezone(office.timezone);
        const now = new Date();

        let day: string, time: string;
        try {
          const df = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz });
          day = df.format(now).toLowerCase();
          const tf = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
          const parts = tf.formatToParts(now);
          time = `${(parts.find(p => p.type === 'hour')?.value ?? '00').padStart(2, '0')}:${(parts.find(p => p.type === 'minute')?.value ?? '00').padStart(2, '0')}`;
        } catch {
          day = DAYS_NAMES[now.getDay()];
          time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        }

        const todayH = hours?.[day];
        if (overrideMode === 'always_open') {
          setStatus({ isOpen: true, reason: 'always_open', todayHours: todayH ?? null, currentDay: day });
          return;
        }
        if (overrideMode === 'always_closed') {
          setStatus({ isOpen: false, reason: 'always_closed', todayHours: todayH ?? null, currentDay: day });
          return;
        }
        if (!hours || Object.keys(hours).length === 0) return;
        const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        if (!todayH || (todayH.open === '00:00' && todayH.close === '00:00')) {
          // Find next open
          const di = DAYS_NAMES.indexOf(day);
          let next: any;
          for (let o = 1; o <= 7; o++) {
            const d = DAYS_NAMES[(di + o) % 7];
            const h = hours[d];
            if (h && !(h.open === '00:00' && h.close === '00:00')) { next = { day: d, time: h.open }; break; }
          }
          setStatus({ isOpen: false, reason: 'closed_today', todayHours: null, nextOpen: next, currentDay: day });
        } else {
          const cm = toMins(time), om = toMins(todayH.open), clm = toMins(todayH.close);
          const isOpen = cm >= om && cm < clm;
          setStatus({ isOpen, reason: isOpen ? 'open' : (cm < om ? 'before_hours' : 'after_hours'), todayHours: todayH, currentDay: day });
        }
      } catch { /* ignore */ }
    }
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [session.office_id, session.office_ids]);

  if (!status) return null;

  const cap = (s: string) => t(s.charAt(0).toUpperCase() + s.slice(1));

  return (
    <div className="sidebar-section" style={{ flex: '0 0 auto' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        {t('Office Hours')}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        borderRadius: 8, fontSize: 13,
        background: status.isOpen ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
        color: status.isOpen ? '#16a34a' : '#dc2626',
        fontWeight: 600,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: status.isOpen ? '#22c55e' : '#ef4444',
        }} />
        {status.reason === 'always_open'
          ? t('Always open')
          : status.reason === 'always_closed'
          ? t('Always closed')
          : status.isOpen
          ? t('Open until {time}', { time: status.todayHours?.close || '' })
          : status.reason === 'before_hours'
          ? t('Opens at {time}', { time: status.todayHours?.open || '' })
          : status.nextOpen
          ? t('Closed - opens {day} {time}', { day: cap(status.nextOpen.day), time: status.nextOpen.time })
          : t('Closed')
        }
      </div>
    </div>
  );
}

function RemoteSupportSection({ t }: { t: (key: string, values?: Record<string, string | number | null | undefined>) => string }) {
  const [showSupport, setShowSupport] = useState(false);
  const [rdStatus, setRdStatus] = useState<{ installed: boolean; running: boolean; id: string | null }>({ installed: false, running: false, id: null });
  const [rdSession, setRdSession] = useState<{ id: string | null } | null>(null);
  const [rdLoading, setRdLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState(0);

  useEffect(() => {
    if (!showSupport) return;
    (window as any).qf.support?.rustdesk?.status?.().then((s: any) => setRdStatus(s ?? { installed: false, running: false, id: null })).catch(() => {});
  }, [showSupport]);

  useEffect(() => {
    if (!downloading) return;
    const unsub = (window as any).qf.support?.rustdesk?.onDownloadProgress?.((p: any) => {
      setDlProgress(p.percent ?? 0);
      if (p.status === 'done') {
        setDownloading(false);
        (window as any).qf.support?.rustdesk?.status?.().then((s: any) => setRdStatus(s));
      }
    });
    return unsub;
  }, [downloading]);

  const downloadRustDesk = async () => {
    setDownloading(true);
    setDlProgress(0);
    try {
      const res = await (window as any).qf.support?.rustdesk?.download?.();
      if (res && !res.ok) {
        alert(res.error || t('Download failed'));
        setDownloading(false);
      }
    } catch { setDownloading(false); }
  };

  const startRustDesk = async () => {
    setRdLoading(true);
    try {
      const res = await (window as any).qf.support?.rustdesk?.start?.();
      if (res?.ok) setRdSession({ id: res.id });
    } catch {}
    setRdLoading(false);
  };

  const stopRustDesk = async () => {
    try { await (window as any).qf.support?.rustdesk?.stop?.(); } catch {}
    setRdSession(null);
    setRdStatus(s => ({ ...s, running: false }));
  };

  const copyText = (text: string) => { navigator.clipboard?.writeText(text); };

  return (
    <div className="sidebar-section">
      <button
        onClick={() => setShowSupport((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
        }}
      >
        <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
          {t('Remote Support')}
        </h4>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{showSupport ? '▲' : '▼'}</span>
      </button>
      {showSupport && (
        <div style={{ marginTop: 8 }}>
          <div style={{ background: 'var(--surface2)', padding: '12px 14px', borderRadius: 8 }}>
            {!rdStatus.installed ? (
              /* Not installed — download */
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>🦀</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>RustDesk</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>{t('Full desktop remote control over the internet')}</div>
                {downloading ? (
                  <div>
                    <div style={{ height: 6, background: 'var(--surface)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{ height: '100%', width: `${dlProgress}%`, background: 'var(--primary)', borderRadius: 3, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t('Downloading...')} {dlProgress}%</div>
                  </div>
                ) : (
                  <button onClick={downloadRustDesk} style={{
                    width: '100%', padding: '8px', borderRadius: 6, border: 'none',
                    background: 'var(--primary)', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>
                    {t('Download RustDesk')} (~15 MB)
                  </button>
                )}
              </div>
            ) : rdSession ? (
              /* Active session — show ID */
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginBottom: 6 }}>● {t('Session Active')}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>RustDesk ID</div>
                <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 3, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums', margin: '4px 0 10px' }}>
                  {rdSession.id ?? '...'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10 }}>
                  {t('Share this ID with your tech support')}
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                  <button onClick={() => copyText(rdSession.id ?? '')} style={{
                    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text2)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>
                    {t('Copy')}
                  </button>
                  <button onClick={stopRustDesk} style={{
                    padding: '5px 10px', borderRadius: 6, border: 'none',
                    background: '#ef4444', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>
                    {t('End Session')}
                  </button>
                </div>
              </div>
            ) : (
              /* Ready to start */
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>RustDesk</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{t('Full desktop remote control over the internet')}</div>
                <button onClick={startRustDesk} disabled={rdLoading} style={{
                  width: '100%', padding: '10px', borderRadius: 6, border: 'none',
                  background: 'var(--primary)', color: 'white', fontSize: 13, fontWeight: 700,
                  cursor: rdLoading ? 'default' : 'pointer', opacity: rdLoading ? 0.6 : 1,
                }}>
                  {rdLoading ? t('Launching...') : t('Start Support Session')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Station({ session, locale, isOnline, staffStatus, queuePaused, onStaffStatusChange, onQueuePausedChange }: Props) {
  const SIDEBAR_WIDTH_KEY = 'qflo_station_sidebar_width';
  const SHOW_ACTIVITY_KEY = 'qflo_station_show_activity';
  const SHOW_DEVICES_KEY = 'qflo_station_show_devices';
  const MIN_SIDEBAR_WIDTH = 320;
  const MAX_SIDEBAR_WIDTH = 720;
  const getDisplayUrlLabel = (url: string) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  };
  const getFriendlyPublicUrlLabel = (url: string, type: 'kiosk' | 'display') => {
    try {
      const parsed = new URL(url);
      const token = parsed.pathname.split('/').filter(Boolean).at(-1) ?? '';
      return `${parsed.origin}/${type === 'kiosk' ? 'k' : 'd'}/${token}`;
    } catch {
      return getDisplayUrlLabel(url);
    }
  };

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [names, setNames] = useState<Record<string, Record<string, string>>>({
    departments: {}, services: {}, desks: {},
  });
  const [callCountdown, setCallCountdown] = useState(0);
  const [servingElapsed, setServingElapsed] = useState(0);
  const [searchFilter, setSearchFilter] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState<{ fr: string; ar: string }>({ fr: '', ar: '' });
  const [broadcastLang, setBroadcastLang] = useState<'fr' | 'ar'>('fr');
  const [broadcastTemplates, setBroadcastTemplates] = useState<any[]>([]);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{ sent: number; failed?: number; error?: string } | null>(null);
  const [broadcastSaveAsTemplate, setBroadcastSaveAsTemplate] = useState(false);
  const [broadcastTemplateName, setBroadcastTemplateName] = useState('');
  const [showNotesField, setShowNotesField] = useState(false);
  const [ticketNotes, setTicketNotes] = useState('');
  const [priorityDropdownId, setPriorityDropdownId] = useState<string | null>(null);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const [allServices, setAllServices] = useState<{ id: string; name: string; department_id: string }[]>([]);
  const [messengerPageId, setMessengerPageId] = useState<string | null>(null);
  const [whatsappPhone, setWhatsappPhone] = useState<string | null>(null);
  const [customerHistory, setCustomerHistory] = useState<{ customer: any; recent_tickets: any[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const servingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevWaitingCount = useRef(0);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);
  const formatWait = useCallback((dateStr: string) => formatWaitLabel(dateStr, locale), [locale]);
  const statusLabels = useMemo(() => ({
    available: { ...STAFF_STATUS_LABELS.available, label: t('Available') },
    on_break: { ...STAFF_STATUS_LABELS.on_break, label: t('On Break') },
    away: { ...STAFF_STATUS_LABELS.away, label: t('Away') },
  }), [locale]);
  const translateAction = useCallback((action: string) => {
    const normalized = action.toLowerCase();
    if (normalized === 'served' || normalized === 'completed') return t('Completed');
    if (normalized === 'no_show' || normalized === 'no show') return t('No Show');
    if (normalized === 'requeued') return t('Requeued');
    if (normalized === 'recalled') return t('Recalled');
    if (normalized === 'cancelled') return t('Cancelled');
    if (normalized === 'serving') return t('Serving');
    if (normalized === 'called') return t('Called');
    return action;
  }, [locale]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ticketId: string; ticketNumber: string } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Fetch Messenger Page ID from org branding ───────────────────
  useEffect(() => {
    window.qf.org?.getBranding?.()
      .then((b: { messengerPageId?: string | null; whatsappPhone?: string | null }) => {
        setMessengerPageId(b?.messengerPageId ?? null);
        setWhatsappPhone(b?.whatsappPhone ?? null);
      })
      .catch(() => {});
  }, []);

  // ── Port conflict notification ─────────────────────────────────
  useEffect(() => {
    const unsub = window.qf.onPortChanged?.((info: { requested: number; actual: number }) => {
      showToast(`Port ${info.requested} was in use — running on port ${info.actual}`, 'info');
    });
    return () => unsub?.();
  }, [showToast]);

  // ── Fetch tickets ────────────────────────────────────────────────

  // ALWAYS read from SQLite — the sync engine keeps it up to date
  const fetchTickets = useCallback(async () => {
    const officeIds = session.office_ids?.length ? session.office_ids : [session.office_id];
    const local = await window.qf.db.getTickets(officeIds, ['waiting', 'called', 'serving']);
    setTickets(local.map(parseLocalTicket));
  }, [session.office_id, session.office_ids]);

  // ── Load names for departments, services, desks ─────────────────

  // Load names from SQLite (sync engine keeps them fresh)
  useEffect(() => {
    (async () => {
      try {
        const [depts, svcs, desks] = await Promise.all([
          window.qf.db.query?.('departments', session.office_ids) ?? [],
          window.qf.db.query?.('services', session.office_ids) ?? [],
          window.qf.db.query?.('desks', session.office_ids) ?? [],
        ]);
        setNames({
          departments: Object.fromEntries((depts ?? []).map((d: any) => [d.id, d.name])),
          services: Object.fromEntries((svcs ?? []).map((s: any) => [s.id, s.name])),
          desks: Object.fromEntries((desks ?? []).map((d: any) => [d.id, d.name])),
        });
        setAllServices((svcs ?? []).map((s: any) => ({ id: s.id, name: s.name, department_id: s.department_id })));
      } catch {
        // Names will be empty until sync pulls data
      }
    })();
  }, [session.office_ids]);

  // ── Event-driven refresh + fallback polling ─────────────────────

  useEffect(() => {
    fetchTickets();
    // Listen for push events from main process (instant, no wasted polls)
    const unsub = window.qf.tickets?.onChange?.(fetchTickets);
    // Fallback poll in case events are missed (10s vs old 3s)
    const iv = setInterval(fetchTickets, FALLBACK_POLL_INTERVAL);
    return () => { unsub?.(); clearInterval(iv); };
  }, [fetchTickets]);

  // ── Sync error notifications ───────────────────────────────────
  useEffect(() => {
    const unsub = window.qf.sync?.onError?.((error: { message: string; ticketNumber?: string; type: string }) => {
      showToast(error.message, 'error');
    });
    return () => { unsub?.(); };
  }, [showToast]);

  // ── Sync staff status + queue pause → desk status in Supabase ──
  useEffect(() => {
    if (!session.desk_id) return;

    const deskStatus = staffStatus === 'on_break' ? 'on_break'
      : staffStatus === 'away' ? 'closed'
      : queuePaused ? 'on_break'
      : 'open';

    const update: Record<string, unknown> = { status: deskStatus };
    // When going available/open, also claim the desk for this staff
    if (deskStatus === 'open' && session.staff_id) {
      update.current_staff_id = session.staff_id;
    }

    // Update local SQLite so mobile app (polling via HTTP) sees the change
    window.qf.db.updateDesk?.(session.desk_id, update).catch(() => {});

    getSupabase().then((sb) => {
      sb.from('desks')
        .update(update)
        .eq('id', session.desk_id)
        .then(({ error }: { error: any }) => {
          if (error) console.warn('[Station] desk status sync error:', error.message);
        });
    });
  }, [staffStatus, queuePaused, session.desk_id, session.staff_id]);

  // ── Listen for desk status changes from other platforms ─────────
  useEffect(() => {
    if (!session.desk_id) return;
    let channel: any;
    getSupabase().then((sb) => {
      channel = sb.channel(`desk-status-${session.desk_id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'desks', filter: `id=eq.${session.desk_id}` },
          (payload: any) => {
            const newStatus = payload.new?.status;
            if (!newStatus) return;
            // Only apply if the change wasn't triggered by this Station
            if (newStatus === 'on_break' && staffStatus === 'available' && !queuePaused) {
              onQueuePausedChange(true);
            } else if (newStatus === 'open' && queuePaused) {
              onQueuePausedChange(false);
            } else if (newStatus === 'open' && staffStatus !== 'available') {
              onStaffStatusChange('available');
            }
          })
        .subscribe();
    });
    return () => { if (channel) getSupabase().then((sb) => sb.removeChannel(channel)); };
  }, [session.desk_id, staffStatus, queuePaused]);

  // ── Pause timer ────────────────────────────────────────────────
  useEffect(() => {
    if (queuePaused) {
      if (!pausedAt) setPausedAt(Date.now());
      const iv = setInterval(() => setPauseElapsed(pausedAt ? Math.floor((Date.now() - pausedAt) / 1000) : 0), 1000);
      return () => clearInterval(iv);
    } else {
      setPausedAt(null);
      setPauseElapsed(0);
    }
  }, [queuePaused, pausedAt]);

  // ── Track active ticket (called/serving by this desk) ──────────

  useEffect(() => {
    const mine = tickets.find(
      (t) => (t.status === 'called' || t.status === 'serving') &&
        (t.desk_id === session.desk_id || t.called_by_staff_id === session.staff_id)
    );
    setActiveTicket(mine ?? null);

    // Countdown for called tickets
    if (mine?.status === 'called' && mine.called_at) {
      const elapsed = getSafeElapsedSeconds(mine.called_at);
      const remaining = Math.max(0, CALL_TIMEOUT - elapsed);
      setCallCountdown(remaining);

      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setCallCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setCallCountdown(0);
      if (countdownRef.current) clearInterval(countdownRef.current);
    }

    // Elapsed timer for serving tickets
    if (mine?.status === 'serving' && mine.serving_started_at) {
      const updateElapsed = () => {
        setServingElapsed(getSafeElapsedSeconds(mine.serving_started_at));
      };
      updateElapsed();
      if (servingTimerRef.current) clearInterval(servingTimerRef.current);
      servingTimerRef.current = setInterval(updateElapsed, 1000);
    } else {
      setServingElapsed(0);
      if (servingTimerRef.current) clearInterval(servingTimerRef.current);
    }

    return () => {
      if (servingTimerRef.current) clearInterval(servingTimerRef.current);
    };
  }, [tickets, session.desk_id]);

  // ── Close priority dropdown on outside click ───────────────────
  useEffect(() => {
    if (!priorityDropdownId) return;
    const handler = () => setPriorityDropdownId(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [priorityDropdownId]);

  // ── Fetch customer history when serving a ticket with phone ─────
  useEffect(() => {
    const phone = activeTicket ? getTicketCustomerPhone(activeTicket.customer_data) : null;
    if (!phone || !activeTicket || activeTicket.status !== 'serving') {
      setCustomerHistory(null);
      setShowHistory(false);
      return;
    }
    const ctrl = new AbortController();
    fetch(`http://localhost:8080/api/customer-lookup?phone=${encodeURIComponent(phone)}&orgId=${encodeURIComponent(session.office_id)}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.customer || (data?.recent_tickets && data.recent_tickets.length > 0)) {
          setCustomerHistory(data);
        } else {
          setCustomerHistory(null);
        }
      })
      .catch(() => setCustomerHistory(null));
    return () => ctrl.abort();
  }, [activeTicket?.id, activeTicket?.status]);

  // ── Close context menu on click anywhere ───────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  // ── Sync notes when active ticket changes ──────────────────────
  useEffect(() => {
    if (activeTicket?.status === 'serving') {
      setTicketNotes((activeTicket as any).notes ?? '');
      setShowNotesField(!!(activeTicket as any).notes);
    } else {
      setTicketNotes('');
      setShowNotesField(false);
    }
  }, [activeTicket?.id, activeTicket?.status]);

  // ── Actions ─────────────────────────────────────────────────────

  // ALWAYS write to SQLite first — sync engine pushes to cloud
  const callNext = async () => {
    try {
      const result = await window.qf.db.callNext(session.office_id, session.desk_id!, session.staff_id);
      if (!result) {
        showToast(t('No tickets waiting in queue'), 'info');
        return;
      }
      fetchTickets();
      if (isSmallScreen) setSidebarVisible(false);
    } catch (err: any) {
      showToast(t('Failed to call next ticket'), 'error');
      console.error('[station] callNext error:', err);
    }
  };

  const updateTicketStatus = async (ticketId: string, updates: Record<string, any>) => {
    try {
      const result = await window.qf.db.updateTicket(ticketId, updates);
      if (updates.status === 'called' && !result) {
        showToast(t('Ticket already called by another desk'), 'error');
      }
      fetchTickets();
      if (isSmallScreen && updates.status === 'called') setSidebarVisible(false);
    } catch (err: any) {
      showToast(t('Failed to update ticket'), 'error');
      console.error('[station] updateTicket error:', err);
    }
  };

  const startServing = (id: string) => {
    updateTicketStatus(id, { status: 'serving', serving_started_at: new Date().toISOString() });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Serving'));
  };

  const complete = (id: string) => {
    updateTicketStatus(id, { status: 'served', completed_at: new Date().toISOString() });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Completed'));
    showToast(t('{ticket} completed', { ticket: ticket?.ticket_number ?? translate(locale, 'Ticket') }), 'success');
  };

  const noShow = (id: string) => {
    updateTicketStatus(id, { status: 'no_show', completed_at: new Date().toISOString() });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'No Show'));
    showToast(t('{ticket} marked no-show', { ticket: ticket?.ticket_number ?? translate(locale, 'Ticket') }), 'info');
  };

  const banCustomer = async (id: string) => {
    const ticket = tickets.find((t) => t.id === id);
    const name = ticket?.customer_data?.name || ticket?.customer_data?.phone || ticket?.ticket_number;
    const reason = prompt(t('Reason for ban (optional):'));
    if (reason === null) return; // user cancelled
    const result = await window.qf.db.banCustomer(id, reason || undefined);
    if (result?.error) {
      showToast(result.error, 'error');
    } else {
      showToast(t('{name} has been banned', { name: result?.name || name || 'Customer' }), 'info');
      if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Banned'));
    }
  };

  const recall = async (id: string) => {
    const t = tickets.find((t) => t.id === id);
    await updateTicketStatus(id, {
      called_at: new Date().toISOString(),
      recall_count: (t?.recall_count ?? 0) + 1,
    });
    if (t) addActivity(t.ticket_number, translate(locale, 'Recalled'));
  };

  const requeue = (id: string) => {
    updateTicketStatus(id, {
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: null,
    });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, translate(locale, 'Requeued'));
  };

  const takeOver = (id: string) => {
    updateTicketStatus(id, {
      desk_id: session.desk_id,
      called_by_staff_id: session.staff_id,
    });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Taken over'));
  };

  const park = (id: string) => {
    updateTicketStatus(id, {
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: new Date().toISOString(),
    });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) {
      addActivity(ticket.ticket_number, translate(locale, 'Ticket parked'));
      showToast(t('Ticket parked'), 'info');
    }
  };

  const resumeParked = (id: string) => {
    // Check if desk already has an active ticket
    const hasActive = tickets.some(
      (tk) => (tk.status === 'called' || tk.status === 'serving') &&
        tk.desk_id === session.desk_id
    );
    if (hasActive) {
      showToast(t('Complete or park the current ticket first'), 'error');
      return;
    }
    updateTicketStatus(id, {
      status: 'called',
      desk_id: session.desk_id,
      called_by_staff_id: session.staff_id,
      called_at: new Date().toISOString(),
      parked_at: null,
    });
    const ticket = tickets.find((tk) => tk.id === id);
    if (ticket) {
      addActivity(ticket.ticket_number, translate(locale, 'Ticket called back to desk'));
      showToast(t('Ticket called back to desk'), 'success');
    }
  };

  const unparkToQueue = (id: string) => {
    updateTicketStatus(id, {
      status: 'waiting',
      parked_at: null,
    });
    const ticket = tickets.find((tk) => tk.id === id);
    if (ticket) {
      addActivity(ticket.ticket_number, translate(locale, 'Ticket sent back to queue'));
      showToast(t('Ticket sent back to queue'), 'info');
    }
  };

  const cancel = (id: string) => {
    updateTicketStatus(id, { status: 'cancelled', cancelled_at: new Date().toISOString() });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, translate(locale, 'Cancelled'));
  };

  const bookInHouse = async (data: { department_id: string; service_id?: string; customer_data: { name?: string; phone?: string }; priority: number; source: string }) => {
    try {
      console.log('[station] bookInHouse called, data:', JSON.stringify(data));
      // crypto.randomUUID() is only available in secure contexts (HTTPS/localhost)
      // Fallback to crypto.getRandomValues for plain HTTP (e.g., local network station)
      const uuid = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : ('10000000-1000-4000-8000-100000000000').replace(/[018]/g, (c) => (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16));
      const result = await window.qf.db.createTicket({
        id: uuid,
        ticket_number: '', // auto-generated by IPC handler
        office_id: session.office_id,
        department_id: data.department_id,
        service_id: data.service_id ?? null,
        priority: data.priority,
        customer_data: data.customer_data,
        source: data.source,
        created_at: new Date().toISOString(),
      });
      console.log('[station] createTicket result:', JSON.stringify(result));
      fetchTickets();
      const customerLabel = data.customer_data.name || translate(locale, 'Walk-in');
      showToast(translate(locale, 'Ticket created: {ticket} for {name}', { ticket: result.ticket_number, name: customerLabel }), 'success');
      addActivity(result.ticket_number, translate(locale, 'In-house booking'));
      return result; // return to modal for confirmation screen
    } catch (err: any) {
      showToast(translate(locale, 'Failed to create ticket'), 'error');
      console.error('[station] bookInHouse error:', err);
      return null;
    }
  };

  // ── Broadcast functions ────────────────────────────────────────
  const CLOUD_URL = 'https://qflo.net';

  const fetchBroadcastTemplates = useCallback(async () => {
    try {
      const sb = await getSupabase();
      const { data } = await sb
        .from('broadcast_templates')
        .select('id, title, body_fr, body_ar, body_en, created_at')
        .eq('organization_id', session.organization_id)
        .order('created_at', { ascending: false });
      setBroadcastTemplates(data ?? []);
    } catch (err) {
      console.error('[broadcast] Failed to fetch templates:', err);
    }
  }, [session.organization_id]);

  const saveBroadcastTemplate = useCallback(async (title: string, bodyFr: string, bodyAr: string) => {
    try {
      const sb = await getSupabase();
      const { error } = await sb.from('broadcast_templates').insert({
        organization_id: session.organization_id,
        title,
        body_fr: bodyFr || null,
        body_ar: bodyAr || null,
      });
      if (error) {
        console.error('[broadcast] Supabase insert error:', error.message);
        showToast(t('Error saving template'), 'error');
        return;
      }
      await fetchBroadcastTemplates();
      showToast(t('Template saved'), 'success');
    } catch (err) {
      console.error('[broadcast] Failed to save template:', err);
      showToast(t('Error saving template'), 'error');
    }
  }, [session.organization_id, fetchBroadcastTemplates]);

  const deleteBroadcastTemplate = useCallback(async (id: string) => {
    try {
      const sb = await getSupabase();
      await sb.from('broadcast_templates').delete().eq('id', id).eq('organization_id', session.organization_id);
      setBroadcastTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error('[broadcast] Failed to delete template:', err);
    }
  }, [session.organization_id]);

  const sendBroadcast = useCallback(async (msg: { fr: string; ar: string }, templateId?: string) => {
    setBroadcastSending(true);
    setBroadcastResult(null);
    try {
      const messageBody = msg[broadcastLang] || msg.fr || msg.ar;
      console.log('[broadcast] Sending to', CLOUD_URL, 'org:', session.organization_id);
      // Get current Supabase session for JWT auth
      const sb = await getSupabase();
      const { data: { session: sbSession } } = await sb.auth.getSession();
      const accessToken = sbSession?.access_token ?? '';
      const res = await fetch(`${CLOUD_URL}/api/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'x-org-id': session.organization_id,
          'x-user-id': session.user_id,
        },
        body: JSON.stringify({
          organizationId: session.organization_id,
          officeId: session.office_id,
          message: templateId ? undefined : messageBody,
          locale: broadcastLang,
          templateId,
        }),
      });
      const result = await res.json();
      console.log('[broadcast] Response:', res.status, JSON.stringify(result));
      if (!res.ok || result.error) {
        const errMsg = result.error || result.reason || `HTTP ${res.status}`;
        console.error('[broadcast] API error:', res.status, errMsg);
        setBroadcastResult({ sent: 0, failed: -1, error: errMsg });
        return;
      }
      setBroadcastResult({ sent: result.sent ?? 0, failed: result.failed });
    } catch (err: any) {
      console.error('[broadcast] Send error:', err);
      setBroadcastResult({ sent: 0, failed: -1, error: err?.message ?? 'Network error' });
    } finally {
      setBroadcastSending(false);
    }
  }, [session.organization_id, session.office_id, session.user_id, broadcastLang]);

  // ── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Skip shortcuts when a modal with inputs is open (let typing work normally)
      if ((showBookingModal || showBroadcast) && e.key !== 'F6') return;

      // Ctrl+Enter or F8: Call Next (respects pause)
      if (((e.ctrlKey && e.key === 'Enter') || e.key === 'F8') && !activeTicket && session.desk_id && !queuePaused && staffStatus === 'available') {
        e.preventDefault();
        callNext();
      }
      // F7: Toggle queue pause
      if (e.key === 'F7' && session.desk_id) {
        e.preventDefault();
        onQueuePausedChange(!queuePaused);
      }
      // F9: Start Serving (when called)
      if (e.key === 'F9' && activeTicket?.status === 'called') {
        e.preventDefault();
        startServing(activeTicket.id);
      }
      // F6: In-House Booking (toggle)
      if (e.key === 'F6' && session.desk_id) {
        e.preventDefault();
        setShowBookingModal(prev => !prev);
      }
      // F10: Complete (when serving)
      if (e.key === 'F10' && activeTicket?.status === 'serving') {
        e.preventDefault();
        complete(activeTicket.id);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeTicket, session.desk_id, queuePaused, staffStatus, showBookingModal, showBroadcast]);

  // ── Derived data ────────────────────────────────────────────────

  const [kioskUrl, setKioskUrl] = useState<string | null>(null);
  const [publicLinks, setPublicLinks] = useState<{ kioskUrl: string | null; displayUrl: string | null }>({
    kioskUrl: null,
    displayUrl: null,
  });
  const [deviceStatuses, setDeviceStatuses] = useState<any[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => { setIsSmallScreen(e.matches); if (!e.matches) setSidebarVisible(false); };
    setIsSmallScreen(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (!stored) return;
      const parsed = Number(stored);
      if (!Number.isFinite(parsed)) return;
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed)));
    } catch {
      // ignore persistence failures
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // ignore persistence failures
    }
  }, [sidebarWidth]);

  const startSidebarResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const isRtl = document.documentElement.dir === 'rtl';
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = isRtl ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, startWidth + delta)
      );
      setSidebarWidth(nextWidth);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [sidebarWidth]);

  useEffect(() => {
    window.qf.kiosk?.getUrl?.().then((url: string | null) => setKioskUrl(url));
    window.qf.links?.getPublic?.()
      .then((links: { kioskUrl: string | null; displayUrl: string | null } | null | undefined) => {
        setPublicLinks({
          kioskUrl: links?.kioskUrl ?? null,
          displayUrl: links?.displayUrl ?? null,
        });
      })
      .catch(() => {
        setPublicLinks({ kioskUrl: null, displayUrl: null });
      });
  }, []);

  // Ping as station device + check all device statuses
  useEffect(() => {
    let port: number | null = null;
    const checkDevices = async () => {
      try {
        if (!port) port = await (window as any).qf.getKioskPort();
        if (!port) return;
        const base = (window as any).__QF_HTTP_MODE__ ? window.location.origin : `http://localhost:${port}`;
        const res = await fetch(`${base}/api/device-status`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const d = await res.json();
          setDeviceStatuses(d.devices ?? []);
        }
      } catch { /* kiosk server may not be ready yet */ }
    };
    checkDevices();
    const iv = setInterval(checkDevices, DEVICE_CHECK_INTERVAL);
    return () => clearInterval(iv);
  }, []);

  const waiting = useMemo(() => tickets.filter((t) => t.status === 'waiting' && !t.parked_at), [tickets]);
  const parked = useMemo(() => tickets.filter((t) => t.status === 'waiting' && !!t.parked_at), [tickets]);
  const called = useMemo(() => tickets.filter((t) => t.status === 'called'), [tickets]);
  const serving = useMemo(() => tickets.filter((t) => t.status === 'serving'), [tickets]);

  // ── Recent activity log ─────────────────────────────────────────
  const [recentActivity, setRecentActivity] = useState<Array<{ ticket: string; action: string; time: string }>>([]);

  // Load recent activity from audit log on mount (persisted across restarts)
  useEffect(() => {
    if (!session?.office_id) return;
    (window as any).qf?.activity?.getRecent(session.office_id, 10).then((rows: any[]) => {
      if (rows?.length) {
        setRecentActivity(rows.map((r: any) => ({
          ticket: r.ticket,
          action: translateAction(r.action),
          time: formatDesktopTime(r.time, locale),
        })));
      }
    }).catch(() => {});
  }, [locale, session?.office_id, translateAction]);

  // Track completed actions — only keep the latest status per ticket
  const addActivity = useCallback((ticket: string, action: string) => {
    setRecentActivity((prev) => {
      const filtered = prev.filter((a) => a.ticket !== ticket);
      return [
        { ticket, action, time: formatDesktopTime(new Date(), locale) },
        ...filtered.slice(0, 9),
      ];
    });
  }, [locale]);

  // Sound alert when new ticket arrives
  useEffect(() => {
    if (waiting.length > prevWaitingCount.current && prevWaitingCount.current > 0) {
      try { new Audio('data:audio/wav;base64,UklGRl9vT19teleVBRk10AAAACQBAAABAAAAAQA8AB//gAQBkYXRhSAAAAGAAAAAAAAAAAAAAAAA=').play().catch(() => {}); } catch {}
    }
    prevWaitingCount.current = waiting.length;
  }, [waiting.length]);

  // Debounced search — 300ms delay to prevent lag on slow hardware
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(searchFilter), 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchFilter]);

  // Filter waiting list by search
  const filteredWaiting = useMemo(() => {
    if (!debouncedSearch) return waiting;
    const q = debouncedSearch.toLowerCase();
    return waiting.filter((t) =>
      t.ticket_number.toLowerCase().includes(q)
      || (getTicketCustomerName(t.customer_data) ?? '').toLowerCase().includes(q)
      || (getTicketCustomerPhone(t.customer_data) ?? '').includes(q)
    );
  }, [waiting, debouncedSearch]);

  // Virtualization: only render first N items to avoid DOM bloat with 100+ tickets
  const VISIBLE_CHUNK = 50;
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showDevices, setShowDevices] = useState(true);
  const visibleWaiting = useMemo(() => {
    if (showAllWaiting || filteredWaiting.length <= VISIBLE_CHUNK) return filteredWaiting;
    return filteredWaiting.slice(0, VISIBLE_CHUNK);
  }, [filteredWaiting, showAllWaiting]);

  useEffect(() => {
    try {
      const storedShowActivity = window.localStorage.getItem(SHOW_ACTIVITY_KEY);
      if (storedShowActivity === 'true' || storedShowActivity === 'false') {
        setShowActivity(storedShowActivity === 'true');
      }
      const storedShowDevices = window.localStorage.getItem(SHOW_DEVICES_KEY);
      if (storedShowDevices === 'true' || storedShowDevices === 'false') {
        setShowDevices(storedShowDevices === 'true');
      }
    } catch {
      // ignore persistence failures
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_ACTIVITY_KEY, String(showActivity));
    } catch {
      // ignore persistence failures
    }
  }, [showActivity]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_DEVICES_KEY, String(showDevices));
    } catch {
      // ignore persistence failures
    }
  }, [showDevices]);


  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="station" role="main">
      {/* Sidebar toggle for mobile/tablet */}
      {isSmallScreen && (
        <>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarVisible(v => !v)}
            aria-label={sidebarVisible ? t('Close queue') : t('Open queue')}
            aria-expanded={sidebarVisible}
          >
            {sidebarVisible ? '\u2715' : '\u2630'}
            {!sidebarVisible && waiting.length > 0 && (
              <span className="sidebar-toggle-badge">{waiting.length}</span>
            )}
          </button>
          {sidebarVisible && (
            <div className="sidebar-backdrop visible" onClick={() => setSidebarVisible(false)} />
          )}
        </>
      )}
      {/* Left panel — active ticket */}
      <div className="station-main" aria-label={t('Active tickets')}>
        {!session.desk_id ? (
          <div className="no-desk" role="alert">
            <h2>{t('No Desk Assigned')}</h2>
            <p>{t('Ask your admin to assign you to a desk before you can start serving.')}</p>
          </div>
        ) : activeTicket ? (
          <div className="active-ticket-panel">
            {activeTicket.status === 'called' ? (
              <>
                <div className="active-status called">{t('CALLING')}</div>
                <div className="active-number">{activeTicket.ticket_number}</div>
                <div className="queue-item-badges" style={{ justifyContent: 'center', marginBottom: 4 }}>
                  {activeTicket.source === 'whatsapp' && <span className="badge whatsapp">{t('WhatsApp')}</span>}
                  {activeTicket.source === 'messenger' && <span className="badge messenger">{t('Messenger')}</span>}
                  {activeTicket.source === 'qr_code' && <span className="badge qr-code">{t('QR Code')}</span>}
                  {activeTicket.source === 'mobile_app' && <span className="badge mobile-app">{t('Mobile App')}</span>}
                  {activeTicket.source === 'kiosk' && <span className="badge kiosk">{t('Kiosk')}</span>}
                  {activeTicket.source === 'in_house' && <span className="badge in-house">{t('In-House')}</span>}
                  {activeTicket.priority > 1 && <span className="badge priority">P{activeTicket.priority}</span>}
                </div>
                <div className="active-customer">
                  {getTicketCustomerName(activeTicket.customer_data) ?? t('Walk-in Customer')}
                </div>
                {getTicketCustomerPhone(activeTicket.customer_data) && (
                  <div className="active-phone">{getTicketCustomerPhone(activeTicket.customer_data)}</div>
                )}
                {((activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes) && (
                  <div className="active-notes">
                    <strong>{t('Reason:')}</strong> {(activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes}
                  </div>
                )}
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? t('Service')} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? t('Dept')}
                </div>

                {/* Countdown */}
                <div className="countdown-ring" role="timer" aria-label={t('{seconds} seconds remaining', { seconds: callCountdown })}>
                  <svg viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#1e293b" strokeWidth="6" />
                    <circle
                      cx="50" cy="50" r="45" fill="none"
                      stroke={callCountdown > 15 ? '#3b82f6' : callCountdown > 5 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="6"
                      strokeDasharray={`${(callCountdown / CALL_TIMEOUT) * 283} 283`}
                      strokeLinecap="round"
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                  <span className="countdown-text">{callCountdown}s</span>
                </div>

                <div className="active-actions">
                  <button className="btn-primary btn-lg" onClick={() => startServing(activeTicket.id)} title="F9">
                    {t('Start Serving')} <span className="shortcut-hint">F9</span>
                  </button>
                  <div className="secondary-actions">
                    <button className="btn-outline" onClick={() => recall(activeTicket.id)} aria-label={`${t('Recall')} ${activeTicket.ticket_number}`}>
                      {t('Recall')} ({activeTicket.recall_count})
                    </button>
                    <button className="btn-outline btn-warning" onClick={() => noShow(activeTicket.id)} aria-label={`${t('No Show')} ${activeTicket.ticket_number}`}>
                      {t('No Show')}
                    </button>
                    <button className="btn-outline" onClick={() => park(activeTicket.id)} aria-label={`${t('Park')} ${activeTicket.ticket_number}`}>
                      {t('Park')}
                    </button>
                    <button className="btn-outline" onClick={() => requeue(activeTicket.id)} aria-label={`${t('Back to Queue')} ${activeTicket.ticket_number}`}>
                      {t('Back to Queue')}
                    </button>
                    <button className="btn-outline" onClick={() => {
                      const deskList = Object.entries(names.desks).filter(([id]) => id !== session.desk_id);
                      if (deskList.length === 0) { showToast(t('No other desks available'), 'error'); return; }
                      setShowTransferModal(true);
                    }} aria-label={`${t('Transfer')} ${activeTicket.ticket_number}`}>
                      {t('Transfer')}
                    </button>
                    <button className="btn-outline btn-danger" onClick={() => banCustomer(activeTicket.id)} aria-label={`${t('Ban')} ${activeTicket.ticket_number}`}>
                      {t('Ban')}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="active-status serving">{t('NOW SERVING')}</div>
                <div className="active-number">{activeTicket.ticket_number}</div>
                <div className="queue-item-badges" style={{ justifyContent: 'center', marginBottom: 4 }}>
                  {activeTicket.source === 'whatsapp' && <span className="badge whatsapp">{t('WhatsApp')}</span>}
                  {activeTicket.source === 'messenger' && <span className="badge messenger">{t('Messenger')}</span>}
                  {activeTicket.source === 'qr_code' && <span className="badge qr-code">{t('QR Code')}</span>}
                  {activeTicket.source === 'mobile_app' && <span className="badge mobile-app">{t('Mobile App')}</span>}
                  {activeTicket.source === 'kiosk' && <span className="badge kiosk">{t('Kiosk')}</span>}
                  {activeTicket.source === 'in_house' && <span className="badge in-house">{t('In-House')}</span>}
                  {activeTicket.priority > 1 && <span className="badge priority">P{activeTicket.priority}</span>}
                </div>
                <div className="active-customer">
                  {getTicketCustomerName(activeTicket.customer_data) ?? t('Walk-in Customer')}
                </div>
                {getTicketCustomerPhone(activeTicket.customer_data) && (
                  <div className="active-phone">{getTicketCustomerPhone(activeTicket.customer_data)}</div>
                )}
                {((activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes) && (
                  <div className="active-notes">
                    <strong>{t('Reason:')}</strong> {(activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes}
                  </div>
                )}
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? t('Service')} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? t('Dept')}
                </div>

                {/* Serving elapsed timer */}
                <div className="serving-timer" role="timer" aria-label={t('Serving for {minutes} minutes {seconds} seconds', { minutes: Math.floor(servingElapsed / 60), seconds: servingElapsed % 60 })} style={{
                  margin: '1rem auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontSize: '2rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: servingElapsed > 1800 ? '#ef4444' : servingElapsed > 900 ? '#f59e0b' : '#22c55e',
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {Math.floor(servingElapsed / 60).toString().padStart(2, '0')}:{(servingElapsed % 60).toString().padStart(2, '0')}
                </div>

                {/* Notes + Customer History row */}
                <div style={{ width: '100%', maxWidth: 500, margin: '0 auto 12px', display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {/* Notes toggle */}
                  {!showNotesField ? (
                    <button
                      onClick={() => setShowNotesField(true)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                        border: '1px solid var(--border)', borderRadius: 8, background: 'transparent',
                        color: 'var(--text2)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      + {t('Add Note')}
                    </button>
                  ) : (
                    <div style={{ flex: '1 1 250px' }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 4 }}>
                        {t('Notes')}
                      </label>
                      <textarea
                        value={ticketNotes}
                        onChange={(e) => setTicketNotes(e.target.value)}
                        onBlur={() => {
                          if (activeTicket) updateTicketStatus(activeTicket.id, { notes: ticketNotes.trim() || null });
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder={t('Add a note about this customer...')}
                        rows={2}
                        style={{
                          width: '100%', padding: '8px 10px', border: '1px solid var(--border)',
                          borderRadius: 8, background: 'var(--surface2)', color: 'var(--text)',
                          fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                          fontFamily: 'inherit',
                        }}
                      />
                    </div>
                  )}

                  {/* Customer History toggle */}
                  {customerHistory && (
                    <button
                      onClick={() => setShowHistory(v => !v)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                        border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8,
                        background: showHistory ? 'rgba(139,92,246,0.12)' : 'transparent',
                        color: '#8b5cf6', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      {t('History')} ({customerHistory.customer?.visit_count ?? customerHistory.recent_tickets?.length ?? 0})
                      <span style={{ fontSize: 9 }}>{showHistory ? '▲' : '▼'}</span>
                    </button>
                  )}
                </div>

                {/* Customer History Panel */}
                {showHistory && customerHistory && (
                  <div style={{
                    width: '100%', maxWidth: 500, margin: '0 auto 12px',
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)',
                  }}>
                    {customerHistory.customer && (
                      <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12, color: 'var(--text)' }}>
                        <div><strong>{t('Visits:')}</strong> {customerHistory.customer.visit_count ?? 0}</div>
                        {customerHistory.customer.last_visit_at && (
                          <div><strong>{t('Last:')}</strong> {new Date(customerHistory.customer.last_visit_at).toLocaleDateString()}</div>
                        )}
                        {customerHistory.customer.tags && customerHistory.customer.tags.length > 0 && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(typeof customerHistory.customer.tags === 'string' ? JSON.parse(customerHistory.customer.tags) : customerHistory.customer.tags).map((tag: string, i: number) => (
                              <span key={i} style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.15)', fontSize: 10, fontWeight: 600 }}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {customerHistory.customer?.notes && (
                      <div style={{ fontSize: 11, color: 'var(--text2)', fontStyle: 'italic', marginBottom: 8 }}>
                        {customerHistory.customer.notes}
                      </div>
                    )}
                    {customerHistory.recent_tickets && customerHistory.recent_tickets.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {t('Recent Visits')}
                        </div>
                        {customerHistory.recent_tickets.map((rt: any, i: number) => (
                          <div key={i} style={{
                            display: 'flex', gap: 8, alignItems: 'center',
                            padding: '4px 0', borderTop: i > 0 ? '1px solid rgba(139,92,246,0.1)' : 'none',
                            fontSize: 11, color: 'var(--text2)',
                          }}>
                            <span style={{ fontWeight: 700, color: 'var(--text)', minWidth: 70 }}>{rt.ticket_number}</span>
                            <span>{rt.department ?? ''}{rt.service ? ` / ${rt.service}` : ''}</span>
                            <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 10 }}>
                              {new Date(rt.created_at).toLocaleDateString()} &middot;{' '}
                              <span style={{ color: rt.status === 'served' ? '#22c55e' : rt.status === 'cancelled' ? '#ef4444' : 'var(--text3)' }}>
                                {rt.status}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="active-actions">
                  <button className="btn-success btn-lg" onClick={() => complete(activeTicket.id)} title="F10">
                    {t('Complete Service')} <span className="shortcut-hint">F10</span>
                  </button>
                  <div className="secondary-actions">
                    <button className="btn-outline" onClick={() => park(activeTicket.id)}>
                      {t('Park')}
                    </button>
                    <button className="btn-outline btn-warning" onClick={() => noShow(activeTicket.id)}>
                      {t('No Show')}
                    </button>
                    <button className="btn-outline btn-danger" onClick={() => cancel(activeTicket.id)}>
                      {t('Cancel')}
                    </button>
                    <button className="btn-outline btn-danger" onClick={() => banCustomer(activeTicket.id)}>
                      {t('Ban')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
          {/* Status + Pause pills — top-right of main area */}
          <div className="station-action-pills">
            {/* Pause toggle — only show when available */}
            {staffStatus === 'available' && (
              <button
                onClick={() => {
                  onQueuePausedChange(!queuePaused);
                  showToast(queuePaused ? t('Queue resumed') : t('Queue paused - no new calls'), queuePaused ? 'success' : 'info');
                }}
                title="F7 — Toggle pause"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 14px', borderRadius: 20,
                  border: queuePaused ? '1.5px solid #f59e0b40' : '1.5px solid #f97316',
                  background: queuePaused ? 'rgba(245,158,11,0.12)' : 'rgba(249,115,22,0.12)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  color: queuePaused ? '#f59e0b' : '#f97316',
                }}
                aria-label={queuePaused ? t('Resume') : t('Pause')}
              >
                {queuePaused ? `▶ ${t('Resume')}` : `⏸ ${t('Pause')}`}
                {queuePaused && pauseElapsed > 0 && <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{`${Math.floor(pauseElapsed / 60)}:${String(pauseElapsed % 60).padStart(2, '0')}`}</span>}
                {!queuePaused && waiting.length > 0 && <span style={{ background: 'rgba(0,0,0,0.12)', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{waiting.length}</span>}
                <span className="shortcut-hint" style={{ color: 'inherit', opacity: 0.6, background: 'rgba(0,0,0,0.1)' }}>F7</span>
              </button>
            )}
            {/* In-House Booking pill */}
            <button
              onClick={() => setShowBookingModal(true)}
              title="F6"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 20,
                border: '1.5px solid rgba(139,92,246,0.4)',
                background: 'rgba(139,92,246,0.12)',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: '#8b5cf6',
              }}
            >
              + {t('In-House Booking')} <span className="shortcut-hint" style={{ color: 'inherit', opacity: 0.6, background: 'rgba(0,0,0,0.1)' }}>F6</span>
            </button>
            {/* Broadcast pill */}
            <button
              onClick={() => { setShowBroadcast(true); fetchBroadcastTemplates(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 20,
                border: '1.5px solid rgba(14,165,233,0.4)',
                background: 'rgba(14,165,233,0.12)',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: '#0ea5e9',
              }}
            >
              {'\u{1F4E2}'} {t('Broadcast')}
            </button>
            {/* Staff status dropdown — only show when not available */}
            {staffStatus !== 'available' && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowStatusMenu((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 14px', borderRadius: 20,
                  border: `1.5px solid ${statusLabels[staffStatus].color}40`,
                  background: `${statusLabels[staffStatus].color}12`,
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  color: statusLabels[staffStatus].color,
                }}
                aria-label={t('Status: {label}', { label: statusLabels[staffStatus].label })}
              >
                <span>{statusLabels[staffStatus].icon}</span>
                <span>{statusLabels[staffStatus].label}</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
              </button>
              {showStatusMenu && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0,
                  marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden', zIndex: 10, minWidth: 150,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }}>
                  {(Object.entries(statusLabels) as [StaffStatus, typeof statusLabels[StaffStatus]][]).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => {
                        onStaffStatusChange(key);
                        setShowStatusMenu(false);
                        if (key !== 'available' && !queuePaused) onQueuePausedChange(true);
                        if (key === 'available' && queuePaused) onQueuePausedChange(false);
                        showToast(t('Status: {label}', { label: val.label }), 'info');
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '10px 16px', border: 'none', cursor: 'pointer',
                        background: key === staffStatus ? 'var(--surface2)' : 'transparent',
                        color: 'var(--text)', fontSize: 13, fontWeight: 600,
                      }}
                    >
                      <span style={{ color: val.color }}>{val.icon}</span>
                      {val.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>

          <div className="idle-panel">
            {queuePaused || staffStatus !== 'available' ? (
              <>
                {(staffStatus === 'on_break' || staffStatus === 'away') && (
                  <div className="idle-icon" style={{ color: staffStatus === 'on_break' ? '#f59e0b' : '#ef4444' }}>
                    {staffStatus === 'on_break' ? '☕' : '🚫'}
                  </div>
                )}
                <h2>{staffStatus === 'on_break' ? t('On Break') : staffStatus === 'away' ? t('Away') : t('Queue Paused')}</h2>
                {pauseElapsed > 0 && <p style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--text3)', margin: '4px 0' }}>{`${Math.floor(pauseElapsed / 60)}:${String(pauseElapsed % 60).padStart(2, '0')}`}</p>}
                <p>{t('{count} waiting in queue', { count: waiting.length })}</p>
                <button
                  className="btn-primary btn-xl"
                  onClick={() => { onQueuePausedChange(false); onStaffStatusChange('available'); showToast(t('Queue resumed'), 'success'); }}
                  style={{ background: '#22c55e' }}
                >
                  {t('Resume Queue')} <span className="shortcut-hint">F7</span>
                </button>
              </>
            ) : (
              <>
                <div className="idle-icon">✓</div>
                <h2>{t('Ready for Next Customer')}</h2>
                <p>{t('{count} waiting in queue', { count: waiting.length })}</p>
                <button
                  className="btn-primary btn-xl"
                  onClick={callNext}
                  disabled={waiting.length === 0}
                  title="F8 or Ctrl+Enter"
                >
                  {t('Call Next ({count})', { count: waiting.length })} <span className="shortcut-hint">F8</span>
                </button>
              </>
            )}
          </div>
          </>
        )}

        {/* Docked In-House Booking Panel */}
        {showBookingModal && session.desk_id && (
          <InHouseBookingPanel
            locale={locale}
            departments={Object.entries(names.departments)}
            services={allServices}
            officeId={session.office_id}
            onBook={bookInHouse}
            onCollapse={() => setShowBookingModal(false)}
            messengerPageId={messengerPageId}
            whatsappPhone="+213551176598"
          />
        )}
      </div>

      {/* Right panel — queue overview */}
      <div
        className={`station-sidebar${isSmallScreen && sidebarVisible ? ' sidebar-visible' : ''}`}
        role="complementary"
        aria-label={t('Queue Overview')}
        style={isSmallScreen ? undefined : { width: sidebarWidth }}
      >
        <button
          type="button"
          className="station-sidebar-resizer"
          onPointerDown={startSidebarResize}
          aria-label={t('Resize queue panel')}
          title={t('Resize queue panel')}
        />
        <div className="sidebar-section">
          <div className="sidebar-header">
            <h3>{t('Queue Overview')}</h3>
            <div className="queue-stats" aria-label={t('{waiting} waiting, {called} called, {serving} serving', { waiting: waiting.length, called: called.length, serving: serving.length })}>
              <span className="stat-pill waiting" aria-hidden="true">{t('{count} waiting', { count: waiting.length })}</span>
              <span className="stat-pill called" aria-hidden="true">{t('{count} called', { count: called.length })}</span>
              <span className="stat-pill serving" aria-hidden="true">{t('{count} serving', { count: serving.length })}</span>
            </div>
          </div>
        </div>

        <div className="sidebar-section queue-list queue-waiting">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>{t('Waiting ({count})', { count: waiting.length })}</h4>
            {waiting.length > 3 && (
              <input
                type="text"
                placeholder={t('Search...')}
                value={searchFilter}
                onChange={(e) => { setSearchFilter(e.target.value); setShowAllWaiting(false); }}
                className="queue-search"
                aria-label={t('Search waiting queue by name, phone, or ticket number')}
              />
            )}
          </div>
          <div className="ticket-list" role="list" aria-label={t('Waiting tickets')}>
            {visibleWaiting.map((ticket, i) => (
              <div key={ticket.id} className="queue-item" role="listitem"
                aria-label={translate(locale, 'Position {position}, ticket {ticket}, {name}, waiting {wait}', { position: i + 1, ticket: ticket.ticket_number, name: getTicketCustomerName(ticket.customer_data) ?? translate(locale, 'Walk-in'), wait: formatWait(ticket.created_at) })}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, ticketId: ticket.id, ticketNumber: ticket.ticket_number }); }}
              >
                <div className="queue-item-pos" aria-hidden="true">#{i + 1}</div>
                <div className="queue-item-info">
                  <span className="queue-item-number">{ticket.ticket_number}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)' }}>
                    {getTicketCustomerName(ticket.customer_data) ?? translate(locale, 'Walk-in')}
                  </span>
                  {getTicketCustomerPhone(ticket.customer_data) && (
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--text3)', opacity: 0.8, direction: 'ltr', unicodeBidi: 'embed' }}>
                      {getTicketCustomerPhone(ticket.customer_data)}
                    </span>
                  )}
                </div>
                <span className="queue-item-meta" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{formatWait(ticket.created_at)}</span>
                <div className="queue-item-badges">
                  {ticket.priority > 1 && <span className="badge priority">P{ticket.priority}</span>}
                  {ticket.appointment_id && <span className="badge booked">{translate(locale, 'Booked')}</span>}
                  {ticket.source === 'whatsapp' && <span className="badge whatsapp">{translate(locale, 'WhatsApp')}</span>}
                  {ticket.source === 'messenger' && <span className="badge messenger">{translate(locale, 'Messenger')}</span>}
                  {ticket.source === 'qr_code' && <span className="badge qr-code">{translate(locale, 'QR Code')}</span>}
                  {ticket.source === 'mobile_app' && <span className="badge mobile-app">{translate(locale, 'Mobile App')}</span>}
                  {ticket.source === 'kiosk' && <span className="badge kiosk">{translate(locale, 'Kiosk')}</span>}
                  {ticket.source === 'in_house' && <span className="badge in-house">{translate(locale, 'In-House')}</span>}
                  {ticket.is_remote && (!ticket.source || ticket.source === 'walk_in') && <span className="badge remote">{translate(locale, 'Remote')}</span>}
                </div>
                {/* Priority upgrade */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    className="btn-sm"
                    style={{ padding: '2px 6px', fontSize: 13, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', cursor: 'pointer', borderRadius: 4, lineHeight: 1 }}
                    title={translate(locale, 'Set Priority')}
                    onClick={(e) => { e.stopPropagation(); setPriorityDropdownId(priorityDropdownId === ticket.id ? null : ticket.id); }}
                    aria-label={`${translate(locale, 'Set Priority')} ${ticket.ticket_number}`}
                  >
                    &#9650;
                  </button>
                  {priorityDropdownId === ticket.id && (
                    <div style={{
                      position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
                      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)', overflow: 'hidden', minWidth: 110,
                    }}>
                      {[{ label: translate(locale, 'Normal'), value: 0 }, { label: translate(locale, 'Urgent'), value: 2 }, { label: translate(locale, 'VIP'), value: 3 }].map(opt => (
                        <button
                          key={opt.value}
                          onClick={(e) => { e.stopPropagation(); updateTicketStatus(ticket.id, { priority: opt.value }); setPriorityDropdownId(null); showToast(translate(locale, 'Priority set to {level}', { level: opt.label }), 'info'); }}
                          style={{
                            display: 'block', width: '100%', padding: '8px 14px', border: 'none',
                            background: ticket.priority === opt.value ? 'var(--surface2)' : 'transparent',
                            color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          {opt.label} {ticket.priority === opt.value ? '✓' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {session.desk_id && !activeTicket && !queuePaused && staffStatus === 'available' && (
                  <button
                    className="btn-sm btn-call"
                    aria-label={`${translate(locale, 'Call')} ${ticket.ticket_number}`}
                    onClick={() => updateTicketStatus(ticket.id, {
                      status: 'called',
                      desk_id: session.desk_id,
                      called_by_staff_id: session.staff_id,
                      called_at: new Date().toISOString(),
                    })}
                  >
                    {translate(locale, 'Call')}
                  </button>
                )}
              </div>
            ))}
            {!showAllWaiting && filteredWaiting.length > VISIBLE_CHUNK && (
              <button
                onClick={() => setShowAllWaiting(true)}
                style={{
                  width: '100%', padding: '8px', margin: '4px 0', border: 'none',
                  background: 'var(--surface2)', color: 'var(--primary)', borderRadius: 6,
                  cursor: 'pointer', fontSize: 12, fontWeight: 700,
                }}
              >
                {t('Show all {count} tickets ({more} more)', { count: filteredWaiting.length, more: filteredWaiting.length - VISIBLE_CHUNK })}
              </button>
            )}
            {filteredWaiting.length === 0 && (
              <div className="queue-empty">{searchFilter ? t('No matches') : t('No customers waiting')}</div>
            )}
          </div>
        </div>

        <div className="sidebar-section queue-list queue-active">
          <h4>{t('Active ({count})', { count: called.length + serving.length + parked.length })}</h4>
          <div className="ticket-list" role="list" aria-label={t('Active tickets')}>
            {[...called, ...serving].map((ticket) => (
              <div key={ticket.id} className={`queue-item ${ticket.desk_id === session.desk_id ? 'mine' : ''}`} role="listitem" aria-label={translate(locale, 'Ticket {ticket}, {status} at {desk}', { ticket: ticket.ticket_number, status: ticket.status === 'called' ? translate(locale, 'Called') : translate(locale, 'Serving'), desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') })}>
                <div className="queue-item-dot" style={{ background: statusColor(ticket.status) }} aria-hidden="true" />
                <div className="queue-item-info">
                  <span className="queue-item-number">{ticket.ticket_number}</span>
                  <span className="queue-item-meta">
                    {ticket.status === 'called' ? translate(locale, 'Called at {desk}', { desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') }) : translate(locale, 'Serving at {desk}', { desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') })}
                  </span>
                  {getTicketCustomerName(ticket.customer_data) || getTicketCustomerPhone(ticket.customer_data) ? (
                    <span className="queue-item-meta">
                      {[getTicketCustomerName(ticket.customer_data), getTicketCustomerPhone(ticket.customer_data)].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </div>
                {ticket.id !== activeTicket?.id ? (
                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
                    <button
                      className="btn-sm"
                      style={{ background: '#3b82f6', color: '#fff', border: 'none' }}
                      onClick={() => takeOver(ticket.id)}
                      aria-label={`${t('Take Over')} ${ticket.ticket_number}`}
                    >
                      {t('Take Over')}
                    </button>
                    <button
                      className="btn-sm btn-outline"
                      onClick={() => park(ticket.id)}
                      aria-label={`${t('Park')} ${ticket.ticket_number}`}
                    >
                      {t('Park')}
                    </button>
                    <button
                      className="btn-sm btn-outline"
                      onClick={() => requeue(ticket.id)}
                      aria-label={`${t('Reset stuck ticket')} ${ticket.ticket_number}`}
                    >
                      {t('Reset to Queue')}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {parked.map((ticket) => (
              <div key={ticket.id} className="queue-item" role="listitem">
                <div className="queue-item-dot" style={{ background: '#94a3b8' }} aria-hidden="true" />
                <div className="queue-item-info">
                  <span className="queue-item-number">{ticket.ticket_number}</span>
                  <span className="queue-item-meta" style={{ color: '#f59e0b' }}>
                    ⏸ {t('On Hold')} · {[getTicketCustomerName(ticket.customer_data) ?? translate(locale, 'Walk-in'), formatWait(ticket.parked_at ?? ticket.created_at)].join(' · ')}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
                  <button
                    className="btn-sm btn-outline"
                    onClick={() => resumeParked(ticket.id)}
                    disabled={!!activeTicket}
                    title={activeTicket ? t('Complete or park the current ticket first') : t('Resume serving this ticket')}
                    aria-label={`${t('Resume ticket')} ${ticket.ticket_number}`}
                  >
                    {t('Resume')}
                  </button>
                  <button
                    className="btn-sm btn-outline"
                    onClick={() => unparkToQueue(ticket.id)}
                    aria-label={`${t('Send back to queue')} ${ticket.ticket_number}`}
                  >
                    {t('Back to Queue')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>


        {/* Active Desks */}
        {(() => {
          // Show other desks that have active tickets (called/serving)
          const otherDeskTickets = [...called, ...serving].filter(tk => tk.desk_id && tk.desk_id !== session.desk_id);
          const deskMap = new Map<string, { deskName: string; ticket: Ticket }>();
          for (const tk of otherDeskTickets) {
            if (tk.desk_id && !deskMap.has(tk.desk_id)) {
              deskMap.set(tk.desk_id, { deskName: names.desks[tk.desk_id] ?? t('desk'), ticket: tk });
            }
          }
          if (deskMap.size === 0) return null;
          return (
            <div className="sidebar-section" style={{ flex: '0 0 auto' }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 8px' }}>
                {t('Active Desks')}
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Array.from(deskMap.entries()).map(([deskId, { deskName, ticket }]) => (
                  <div key={deskId} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    borderRadius: 8, background: 'var(--surface2)', fontSize: 12,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: ticket.status === 'serving' ? '#22c55e' : '#3b82f6',
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{deskName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {ticket.ticket_number} &middot; {ticket.status === 'serving' ? t('Serving') : t('Called')}
                        {getTicketCustomerName(ticket.customer_data) ? ` &middot; ${getTicketCustomerName(ticket.customer_data)}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Recent Activity — collapsed by default */}
        {recentActivity.length > 0 && (
          <div className="sidebar-section" style={{ flex: '0 0 auto' }}>
            <button
              onClick={() => setShowActivity(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
              }}
            >
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
                {t('Recent Activity ({count})', { count: recentActivity.length })}
              </h4>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{showActivity ? '▲' : '▼'}</span>
            </button>
            {showActivity && (
              <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 6 }} role="list" aria-label={t('Recent activity')}>
                {recentActivity.slice(0, 10).map((a, i) => (
                  <div key={i} role="listitem" style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '3px 0', fontSize: 11, color: 'var(--text2)',
                  }}>
                    <span><strong>{a.ticket}</strong> {a.action} · {a.time}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, marginLeft: 6, whiteSpace: 'nowrap',
                      background: a.action === t('Completed') ? 'rgba(34,197,94,0.15)' : a.action === t('No Show') ? 'rgba(249,115,22,0.15)' : 'rgba(59,130,246,0.15)',
                      color: a.action === t('Completed') ? '#22c55e' : a.action === t('No Show') ? '#f97316' : '#3b82f6',
                    }}>
                      {a.action}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Office Open/Closed Status */}
        <OfficeHoursBadge locale={locale} session={session} />

        {/* Device Status */}
        {/* Devices & Network — unified section */}
        {kioskUrl && (() => {
          const h = window.location.hostname;
          const isLocalNetwork = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/.test(h);
          const isRemote = !!(window as any).__QF_HTTP_MODE__ && !isLocalNetwork;

          // Build device→URL mapping (by normalized name + by type)
          const deviceMap = new Map<string, any>();
          const deviceByType = new Map<string, any>();
          for (const d of deviceStatuses) {
            deviceMap.set(d.name?.toLowerCase().replace(/\s+/g, '_'), d);
            if (d.type) deviceByType.set(d.type, d);
          }
          const findDevice = (names: string[], type: string) =>
            names.reduce<any>((found, n) => found ?? deviceMap.get(n), null) ?? deviceByType.get(type);

          const items = [
            {
              label: t('Station'),
              subtitle: t('remote control'),
              localUrl: kioskUrl.replace('/kiosk', '/station'),
              publicUrl: 'https://qflo.net/station',
              publicLabel: 'https://qflo.net/station',
              icon: '🖥️',
              device: findDevice(['qflo_station', 'station'], 'station'),
            },
            {
              label: t('Kiosk'),
              subtitle: t('take tickets'),
              localUrl: kioskUrl,
              publicUrl: publicLinks.kioskUrl,
              publicLabel: publicLinks.kioskUrl ? getFriendlyPublicUrlLabel(publicLinks.kioskUrl, 'kiosk') : null,
              icon: '🎫',
              device: findDevice(['local_kiosk', 'kiosk'], 'kiosk'),
            },
            {
              label: t('Display'),
              subtitle: t('waiting room TV'),
              localUrl: kioskUrl.replace('/kiosk', '/display'),
              publicUrl: publicLinks.displayUrl,
              publicLabel: publicLinks.displayUrl ? getFriendlyPublicUrlLabel(publicLinks.displayUrl, 'display') : null,
              icon: '📺',
              device: findDevice(['waiting_room_display', 'display'], 'display'),
            },
          ];
          const visibleItems = isRemote ? items.filter((item) => item.publicUrl) : items;
          if (visibleItems.length === 0) return null;
          return (
            <div className="sidebar-section">
              <button
                onClick={() => setShowDevices((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                }}
              >
                <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
                  {isRemote ? t('Remote Access') : t('Devices & Network')}
                </h4>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>{showDevices ? '▲' : '▼'}</span>
              </button>
              {showDevices && (
                <>
                  {visibleItems.map((item) => {
                    const connected = item.device?.connected;
                    return (
                      <div key={item.label} style={{ marginTop: 10, marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 14 }}>{item.icon}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.label}</span>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>— {item.subtitle}</span>
                          {item.device && (
                            <span style={{
                              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                              fontSize: 11, color: connected ? '#22c55e' : 'var(--danger)',
                            }}>
                              <span style={{
                                width: 6, height: 6, borderRadius: 3, flexShrink: 0,
                                background: connected ? '#22c55e' : '#ef4444',
                              }} />
                              {connected ? t('Online') : t('Offline')}
                            </span>
                          )}
                        </div>
                        {!isRemote && (
                          <div
                            style={{
                              background: 'var(--surface2)', padding: '5px 10px', borderRadius: 6,
                              fontFamily: 'monospace', fontSize: 11.5, fontWeight: 600, color: 'var(--primary)',
                              wordBreak: 'break-all', userSelect: 'all', cursor: 'pointer',
                            }}
                            title={t('Click to open')}
                            onClick={() => { window.open(item.localUrl, '_blank'); }}
                          >
                            {getDisplayUrlLabel(item.localUrl)}
                          </div>
                        )}
                        {item.publicUrl ? (
                          <div
                            style={{
                              marginTop: isRemote ? 0 : 4,
                              background: 'var(--surface2)', padding: '5px 10px', borderRadius: 6,
                              fontFamily: 'monospace', fontSize: 11.5, fontWeight: 600, color: '#16a34a',
                              wordBreak: 'break-all', userSelect: 'all', cursor: 'pointer',
                            }}
                            title={t('Click to open')}
                            onClick={() => { window.open(item.publicUrl!, '_blank'); }}
                          >
                            {item.publicLabel ?? getDisplayUrlLabel(item.publicUrl)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!isRemote && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                      {t('Open on any device on this WiFi network. Works offline.')}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* Remote Support */}
        {!isSmallScreen && <RemoteSupportSection t={t} />}
      </div>

      {/* Transfer modal */}
      {showTransferModal && activeTicket && (
        <TransferModal
          locale={locale}
          desks={Object.entries(names.desks).filter(([id]) => id !== session.desk_id)}
          onTransfer={(deskId, deskName) => {
            updateTicketStatus(activeTicket.id, {
              desk_id: deskId, status: 'waiting', called_at: null, called_by_staff_id: null,
            });
            addActivity(activeTicket.ticket_number, `→ ${deskName}`);
            showToast(t('Transferred to {deskName}', { deskName }), 'info');
            setShowTransferModal(false);
          }}
          onClose={() => setShowTransferModal(false)}
        />
      )}

      {/* In-House Booking Modal removed — now docked as panel in station-main */}

      {/* ── Broadcast Modal ─────────────────────────────────────── */}
      {showBroadcast && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowBroadcast(false); setBroadcastResult(null); } }}
        >
          <div
            role="dialog"
            aria-label={t('Broadcast')}
            style={{
              background: 'var(--surface)', borderRadius: 12, padding: 24,
              minWidth: 420, maxWidth: 520, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              maxHeight: '80vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{'\u{1F4E2}'} {t('Broadcast')}</h3>
              <button
                onClick={() => { setShowBroadcast(false); setBroadcastResult(null); }}
                style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18, padding: 4 }}
              >&times;</button>
            </div>

            {/* Language tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {(['fr', 'ar'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setBroadcastLang(lang)}
                  style={{
                    padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: broadcastLang === lang ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                    background: broadcastLang === lang ? 'var(--primary)' : 'transparent',
                    color: broadcastLang === lang ? '#fff' : 'var(--text2)',
                  }}
                >
                  {lang === 'fr' ? t('French') : lang === 'ar' ? t('Arabic') : t('English')}
                </button>
              ))}
            </div>

            {/* Message textarea */}
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>{t('Message')}</label>
            <textarea
              value={broadcastMsg[broadcastLang]}
              onChange={(e) => setBroadcastMsg(prev => ({ ...prev, [broadcastLang]: e.target.value }))}
              placeholder={t('Send to all waiting') + '...'}
              dir={broadcastLang === 'ar' ? 'rtl' : 'ltr'}
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--surface2)', color: 'var(--text)', fontSize: 14, resize: 'vertical',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />

            {/* Save as template toggle */}
            <div style={{ marginTop: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text2)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={broadcastSaveAsTemplate}
                  onChange={(e) => setBroadcastSaveAsTemplate(e.target.checked)}
                />
                {t('Save as Template')}
              </label>
              {broadcastSaveAsTemplate && (
                <input
                  type="text"
                  value={broadcastTemplateName}
                  onChange={(e) => setBroadcastTemplateName(e.target.value)}
                  placeholder={t('Template Name')}
                  style={{
                    marginTop: 6, width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--surface2)',
                    color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
                  }}
                />
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                disabled={broadcastSending || (!broadcastMsg.fr && !broadcastMsg.ar)}
                onClick={async () => {
                  if (broadcastSaveAsTemplate && broadcastTemplateName.trim()) {
                    await saveBroadcastTemplate(broadcastTemplateName.trim(), broadcastMsg.fr, broadcastMsg.ar);
                    setBroadcastSaveAsTemplate(false);
                    setBroadcastTemplateName('');
                  }
                  await sendBroadcast(broadcastMsg);
                }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8,
                  border: 'none', background: '#0ea5e9', color: '#fff', fontSize: 14,
                  fontWeight: 700, cursor: broadcastSending ? 'wait' : 'pointer',
                  opacity: broadcastSending || (!broadcastMsg.fr && !broadcastMsg.ar) ? 0.5 : 1,
                }}
              >
                {broadcastSending ? t('Sending...') : t('Send to all waiting')}
              </button>
            </div>

            {/* Result */}
            {broadcastResult && (
              <div style={{
                marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: broadcastResult.sent > 0 ? 'rgba(34,197,94,0.12)'
                  : broadcastResult.failed === -1 ? 'rgba(239,68,68,0.12)'
                  : 'rgba(245,158,11,0.12)',
                color: broadcastResult.sent > 0 ? '#22c55e'
                  : broadcastResult.failed === -1 ? '#ef4444'
                  : '#f59e0b',
              }}>
                {broadcastResult.sent > 0
                  ? t('Broadcast sent to {count} customers', { count: broadcastResult.sent })
                  : broadcastResult.failed === -1
                  ? `${t('Broadcast error')}${broadcastResult.error ? `: ${broadcastResult.error}` : ''}`
                  : t('No waiting customers with messaging')}
              </div>
            )}

            {/* Saved Templates */}
            {broadcastTemplates.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{t('Saved Templates')}</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {broadcastTemplates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                        background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)',
                      }}
                    >
                      <button
                        onClick={() => {
                          setBroadcastMsg({
                            fr: tmpl.body_fr ?? '',
                            ar: tmpl.body_ar ?? '',
                          });
                        }}
                        style={{
                          flex: 1, textAlign: 'left', background: 'none', border: 'none',
                          color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        {tmpl.title}
                      </button>
                      <button
                        onClick={async () => {
                          setBroadcastSending(true);
                          await sendBroadcast({ fr: tmpl.body_fr ?? '', ar: tmpl.body_ar ?? '' }, tmpl.id);
                          setBroadcastSending(false);
                        }}
                        style={{
                          padding: '4px 10px', borderRadius: 6, border: 'none',
                          background: '#0ea5e9', color: '#fff', fontSize: 11, fontWeight: 700,
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {t('Send')}
                      </button>
                      <button
                        onClick={() => deleteBroadcastTemplate(tmpl.id)}
                        style={{
                          padding: '4px 8px', borderRadius: 6, border: 'none',
                          background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontSize: 11,
                          fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {t('Delete')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Close */}
            <button
              onClick={() => { setShowBroadcast(false); setBroadcastResult(null); }}
              style={{
                marginTop: 16, width: '100%', padding: '10px', border: '1px solid var(--border)',
                borderRadius: 8, background: 'transparent', color: 'var(--text2)',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}
            >
              {t('Close')}
            </button>
          </div>
        </div>
      )}

      {/* Right-click context menu for queue items */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 3000,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.35)', overflow: 'hidden', minWidth: 160,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { cancel(contextMenu.ticketId); showToast(t('{ticket} cancelled', { ticket: contextMenu.ticketNumber }), 'info'); setContextMenu(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '10px 14px', border: 'none', cursor: 'pointer',
              background: 'transparent', color: '#ef4444', fontSize: 13, fontWeight: 600, textAlign: 'left',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            ✕ {t('Cancel & Remove')}
          </button>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

function parseLocalTicket(row: any): Ticket {
  let customerData = row.customer_data ?? {};
  if (typeof customerData === 'string') {
    try { customerData = JSON.parse(customerData); } catch { customerData = {}; }
  }
  return {
    ...row,
    customer_data: customerData,
    is_remote: !!row.is_remote,
    is_offline: !!row.is_offline,
  };
}
