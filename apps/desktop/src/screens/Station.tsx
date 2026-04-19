import React, { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { getSupabase, ensureAuth, verifyAuthWorks } from '../lib/supabase';
import type { StaffSession, Ticket } from '../lib/types';
import { formatDesktopTime, formatWaitLabel, t as translate, type DesktopLocale } from '../lib/i18n';
import { WILAYAS, formatWilayaLabel, normalizeWilayaDisplay } from '../lib/wilayas';
import { CustomersModal } from '../components/CustomersModal';
import { SettingsModal } from '../components/SettingsModal';
import { TeamModal } from '../components/TeamModal';
import { BusinessAdminModal } from '../components/BusinessAdminModal';
import { CalendarModal } from '../components/CalendarModal';
import { useConfirmDialog } from '../components/ConfirmDialog';
import DatePicker from '../components/DatePicker';
import { cloudFetch } from '../lib/cloud-fetch';
import { dateKeyInTz, getDayNameFromKey, getDayHours, CALENDAR_DAYS, migrateToIntakeFields, getFieldLabel, INTAKE_PRESETS, type IntakeField, type PresetKey } from '@qflo/shared';

const STATION_RDV_STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  confirmed: '#3b82f6',
  checked_in: '#06b6d4',
  serving: '#f97316',
  completed: '#22c55e',
  cancelled: '#ef4444',
  declined: '#991b1b',
  no_show: '#64748b',
};

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
function InHouseBookingPanel({ departments, services, officeId, onBook, locale, messengerPageId, whatsappPhone, onCollapse, session, prefill, storedAuth, timezone = 'Africa/Algiers', orgSettings = {} }: {
  departments: [string, string][]; // [id, name][]
  services: { id: string; name: string; department_id: string }[];
  officeId: string;
  onBook: (ticket: { department_id: string; service_id?: string; customer_data: Record<string, any>; priority: number; source: string }) => Promise<any>;
  locale: DesktopLocale;
  messengerPageId?: string | null;
  whatsappPhone?: string | null;
  onCollapse: () => void;
  session: any;
  prefill?: { name?: string; phone?: string; notes?: string; wilaya?: string; futureDate?: string; futureTime?: string; _ts?: number } | null;
  storedAuth?: Record<string, unknown>;
  timezone?: string;
  orgSettings?: Record<string, any>;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);
  const [bookingTab, setBookingTab] = useState<'walkin' | 'future'>('walkin');
  const [selectedDept, setSelectedDept] = useState(departments[0]?.[0] ?? '');
  const [selectedService, setSelectedService] = useState('');
  // Auto-select first dept when departments load
  useEffect(() => {
    if (!selectedDept && departments.length > 0) setSelectedDept(departments[0][0]);
  }, [departments, selectedDept]);
  // Auto-select first service for the selected dept
  useEffect(() => {
    if (!selectedDept) return;
    const deptServices = services.filter(s => s.department_id === selectedDept);
    if (deptServices.length > 0 && !deptServices.some(s => s.id === selectedService)) {
      setSelectedService(deptServices[0].id);
    }
  }, [selectedDept, services, selectedService]);
  // Unified intake fields from org settings — same source WhatsApp /
  // Messenger / web booking flows use. Any field the admin enabled is
  // shown on both tabs of the in-house panel so the operator captures
  // the same customer info a self-service booking would ask for.
  // (Scope is preserved in the config but not filtered here — the
  //  in-house panel is manual entry by staff, and hiding fields behind
  //  a tab switch would be a footgun. If the field is enabled, it shows.)
  const intakeFields = useMemo(() => migrateToIntakeFields(orgSettings), [orgSettings]);
  const enabledFields = useMemo(
    () => intakeFields.filter(f => f.enabled),
    [intakeFields],
  );

  // Dynamic customer data state — keyed by field key
  const [customerData, setCustomerData] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (prefill?.name) init.name = prefill.name;
    if (prefill?.phone) init.phone = prefill.phone;
    if (prefill?.notes) init.reason = prefill.notes;
    if (prefill?.wilaya) init.wilaya = normalizeWilayaDisplay(prefill.wilaya, locale === 'ar') ?? '';
    return init;
  });
  const setField = (key: string, value: string) => setCustomerData(prev => ({ ...prev, [key]: value }));

  // Backward-compat aliases so existing code (customer search, submit, etc.) still works
  const customerName = customerData.name ?? '';
  const setCustomerName = (v: string) => setField('name', v);
  const customerPhone = customerData.phone ?? '';
  const setCustomerPhone = (v: string) => setField('phone', v);
  const customerReason = customerData.reason ?? '';
  const setCustomerReason = (v: string) => setField('reason', v);
  const customerWilaya = customerData.wilaya ?? '';
  const setCustomerWilaya = (v: string) => setField('wilaya', v);

  // Update walk-in + future fields when prefill changes (panel may already be mounted).
  // Always override ALL fields so a second customer click fully replaces the first.
  useEffect(() => {
    if (!prefill) return;
    const displayW = normalizeWilayaDisplay(prefill.wilaya, locale === 'ar') ?? '';
    setCustomerData({
      name: prefill.name ?? '',
      phone: prefill.phone ?? '',
      reason: prefill.notes ?? '',
      wilaya: displayW,
    });
    // Future-tab fields now proxy customerData so no separate sync needed.
  }, [prefill]);

  // Smart customer search (shared between walk-in and future tabs)
  type CustSuggestion = { id: string; name: string | null; phone: string | null; email: string | null; notes: string | null; visit_count: number; wilaya_code: string | null };
  const [custSuggestions, setCustSuggestions] = useState<CustSuggestion[]>([]);
  const [showCustSuggestions, setShowCustSuggestions] = useState(false);
  const custSearchSeq = useRef(0);

  // Format Algerian phones for display (+213XXXXXXXXX → 0XXXXXXXXX)
  const formatAlgPhoneLocal = (p: string | null): string => {
    if (!p) return '';
    const d = p.replace(/[^\d+]/g, '');
    if (d.startsWith('+213')) return '0' + d.slice(4);
    if (d.startsWith('213') && d.length >= 12) return '0' + d.slice(3);
    return p;
  };

  const runCustomerSearch = useCallback(async (query: string) => {
    const raw = query.trim();
    if (raw.length < 1) { setCustSuggestions([]); setShowCustSuggestions(false); return; }
    const mySeq = ++custSearchSeq.current;
    try {
      await ensureAuth();
      const sb = await getSupabase();
      let orgId = session?.organization_id;
      if (!orgId || orgId === 'undefined') {
        const { data: userData } = await sb.auth.getUser();
        const authUserId = userData?.user?.id;
        if (authUserId) {
          const { data: staffRow } = await sb.from('staff').select('organization_id').eq('auth_user_id', authUserId).single();
          orgId = (staffRow as any)?.organization_id ?? '';
        }
      }
      if (!orgId) { console.warn('[customer-search] no orgId'); return; }
      // Sanitize out PostgREST .or() delimiters
      const safe = raw.replace(/[%,()]/g, ' ').trim();
      const digits = raw.replace(/\D/g, '');
      const tokens = safe.split(/\s+/).filter(Boolean);

      // Build OR conditions:
      //  - name/email ILIKE for the full query (prefix/substring)
      //  - name/email ILIKE for each individual token (first letters, partial)
      //  - phone ILIKE with digit-only variants (handles +213 vs local 0)
      const conds: string[] = [];
      if (safe) {
        conds.push(`name.ilike.%${safe}%`);
        conds.push(`email.ilike.%${safe}%`);
      }
      for (const tok of tokens) {
        if (tok.length >= 1) {
          conds.push(`name.ilike.${tok}%`);   // starts-with (first letters)
          conds.push(`name.ilike.% ${tok}%`); // word-start inside name
        }
      }
      if (digits.length >= 2) {
        // Phone stored as +213XXXXXXXXX; handle local 0XXXXXXXXX input
        const tail = digits.startsWith('0') ? digits.slice(1) : digits;
        conds.push(`phone.ilike.%${digits}%`);
        if (tail && tail !== digits) conds.push(`phone.ilike.%${tail}%`);
      }

      let req = sb
        .from('customers')
        .select('id, name, phone, email, notes, visit_count, wilaya_code')
        .eq('organization_id', orgId)
        .order('last_visit_at', { ascending: false, nullsFirst: false })
        .limit(20);
      if (conds.length) req = req.or(conds.join(','));

      const { data } = await req;
      if (mySeq !== custSearchSeq.current) return;

      // Dedupe by id (Supabase OR conditions can match same row via multiple clauses)
      const deduped = new Map<string, CustSuggestion>();
      for (const c of (data ?? []) as CustSuggestion[]) {
        if (!deduped.has(c.id)) deduped.set(c.id, c);
      }

      // Client-side rank: multi-token AND-match on name, then by visit_count
      const lowerTokens = tokens.map((t) => t.toLowerCase());
      const scored = [...deduped.values()]
        .map((c) => {
          const hay = `${(c.name ?? '').toLowerCase()} ${(c.email ?? '').toLowerCase()} ${(c.phone ?? '')}`;
          const allMatch = lowerTokens.every((tok) => hay.includes(tok));
          const phoneMatch = digits.length >= 2 && (c.phone ?? '').replace(/\D/g, '').includes(digits.startsWith('0') ? digits.slice(1) : digits);
          const score = (allMatch ? 10 : 0) + (phoneMatch ? 5 : 0) + Math.min((c.visit_count ?? 0), 20) / 20;
          return { c, score };
        })
        .filter((x) => x.score > 0 || lowerTokens.length === 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((x) => x.c);

      setCustSuggestions(scored);
      setShowCustSuggestions(scored.length > 0);
    } catch (err) {
      console.warn('[customer-search] failed', err);
    }
  }, [session?.organization_id, storedAuth]);

  // Debounced search triggered by either name or phone typing
  const [custSearchQuery, setCustSearchQuery] = useState('');
  useEffect(() => {
    if (!custSearchQuery) { setCustSuggestions([]); setShowCustSuggestions(false); return; }
    const id = setTimeout(() => { runCustomerSearch(custSearchQuery); }, 220);
    return () => clearTimeout(id);
  }, [custSearchQuery, runCustomerSearch]);

  const pickCustomer = (c: CustSuggestion) => {
    const displayPhone = formatAlgPhoneLocal(c.phone);
    const displayWilaya = normalizeWilayaDisplay(c.wilaya_code, locale === 'ar') ?? '';
    // Both tabs share the same customerData registry now.
    setCustomerName(c.name ?? '');
    setCustomerPhone(displayPhone);
    if (c.notes) setCustomerReason(c.notes);
    if (displayWilaya) setCustomerWilaya(displayWilaya);
    setShowCustSuggestions(false);
    setCustSuggestions([]);
  };
  const [isPriority, setIsPriority] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdTicket, setCreatedTicket] = useState<{ id: string; ticket_number: string; qr_token: string } | null>(null);
  const [customerLookup, setCustomerLookup] = useState<{ visits: number; lastVisit: string; notes?: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<{ sent: boolean; error?: string } | null>(null);
  const [enlargedQr, setEnlargedQr] = useState<{ url: string; label: string } | null>(null);

  // Future booking state
  const [futDept, setFutDept] = useState(departments[0]?.[0] ?? '');
  const [futService, setFutService] = useState('');
  // Auto-select first dept for future booking
  useEffect(() => {
    if (!futDept && departments.length > 0) setFutDept(departments[0][0]);
  }, [departments, futDept]);
  // Auto-select first service for the future-booking dept
  useEffect(() => {
    if (!futDept) return;
    const deptServices = services.filter(s => s.department_id === futDept);
    if (deptServices.length > 0 && !deptServices.some(s => s.id === futService)) {
      setFutService(deptServices[0].id);
    }
  }, [futDept, services, futService]);
  const [futDate, setFutDate] = useState(prefill?.futureDate ?? '');
  const [futTime, setFutTime] = useState(prefill?.futureTime ?? '');
  // Future-tab customer fields proxy the unified customerData registry so the
  // Future form honors the same intake_fields config as walk-in (Age, custom
  // fields, etc. all appear here too — nothing hardcoded).
  const futName = customerData.name ?? '';
  const setFutName = (v: string) => setField('name', v);
  const futPhone = customerData.phone ?? '';
  const setFutPhone = (v: string) => setField('phone', v);
  const futNotes = customerData.reason ?? '';
  const setFutNotes = (v: string) => setField('reason', v);

  // Switch to future tab when prefill includes a date
  useEffect(() => {
    if (prefill?.futureDate) {
      setBookingTab('future');
      setFutDate(prefill.futureDate);
      if (prefill.futureTime) setFutTime(prefill.futureTime);
    }
  }, [prefill?.futureDate, prefill?.futureTime]);
  const futWilaya = customerData.wilaya ?? '';
  const setFutWilaya = (v: string) => setField('wilaya', v);
  // Enriched slot shape: includes taken slots so the operator sees the
  // full day's timeline (taken ones render disabled). `slots` from the
  // API is still available-only for back-compat; we prefer `slotsDetailed`.
  type FutSlot = { time: string; remaining: number; total: number; available: boolean; reason?: 'taken' | 'daily_limit' };
  const [futSlots, setFutSlots] = useState<FutSlot[]>([]);
  const [futSlotsLoading, setFutSlotsLoading] = useState(false);
  const [futSubmitting, setFutSubmitting] = useState(false);
  const [futResult, setFutResult] = useState<{ success: boolean; date?: string; time?: string; error?: string } | null>(null);

  const futDeptServices = useMemo(() =>
    services.filter(s => s.department_id === futDept),
    [services, futDept]
  );

  // Fetch available slots when date/service changes
  useEffect(() => {
    if (!futDate || !futService) { setFutSlots([]); return; }
    setFutSlotsLoading(true);
    const ctrl = new AbortController();
    // Use the links:public API to get the slug, or call booking-slots with officeId
    cloudFetch(`https://qflo.net/api/booking-slots?slug=${encodeURIComponent(officeId)}&serviceId=${encodeURIComponent(futService)}&date=${futDate}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        // Prefer the enriched list (includes taken slots). Fall back to
        // the legacy string[] if the server is old — every slot in that
        // fallback is bookable by definition.
        const detailed: any[] = Array.isArray(data.slotsDetailed) ? data.slotsDetailed : null;
        if (detailed) {
          setFutSlots(detailed.map(s => ({
            time: s.time,
            remaining: Number(s.remaining ?? 0),
            total: Number(s.total ?? 1),
            available: s.available !== false,
            reason: s.reason,
          })));
        } else {
          const legacy: string[] = Array.isArray(data.slots) ? data.slots : [];
          setFutSlots(legacy.map(t => ({ time: t, remaining: 1, total: 1, available: true })));
        }
      })
      .catch(() => setFutSlots([]))
      .finally(() => setFutSlotsLoading(false));
    return () => ctrl.abort();
  }, [futDate, futService, officeId]);

  const handleFutureBook = async () => {
    if (!futDept || !futService || !futDate || !futTime || !futName.trim() || futSubmitting) return;
    // Enforce required intake fields configured in Settings
    const missing = enabledFields
      .filter(f => f.required && !(customerData[f.key]?.trim()))
      .map(f => getFieldLabel(f, locale as 'en' | 'fr' | 'ar'));
    if (missing.length > 0) {
      setFutResult({ success: false, error: `${t('Please fill required fields')}: ${missing.join(', ')}` });
      return;
    }
    setFutSubmitting(true);
    setFutResult(null);
    try {
      const res = await cloudFetch('https://qflo.net/api/book-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          departmentId: futDept,
          serviceId: futService,
          customerName: futName.trim(),
          customerPhone: futPhone.trim() || undefined,
          customerEmail: (customerData.email ?? '').trim() || undefined,
          scheduledAt: `${futDate}T${futTime}:00`,
          notes: futNotes.trim() || undefined,
          wilaya: futWilaya.trim() || undefined,
          source: 'in_house',
        }),
      });
      const data = await res.json();
      if (res.ok && data.appointment) {
        setFutResult({ success: true, date: futDate, time: futTime });
        // Reset entire form so the booked slot disappears and form is ready for next booking.
        // Clear all customerData keys (covers name/phone/wilaya/notes plus age and any custom fields).
        setCustomerData({});
        setFutTime('');
        // Force slots re-fetch by toggling the date (clears then restores)
        const bookedDate = futDate;
        setFutDate('');
        setTimeout(() => setFutDate(bookedDate), 50);
      } else {
        setFutResult({ success: false, error: data.error || 'Booking failed' });
      }
    } catch (err: any) {
      setFutResult({ success: false, error: err.message });
    } finally {
      setFutSubmitting(false);
    }
  };

  // Get min date (today) and max date (today + 30 days)
  const today = new Date().toISOString().split('T')[0];
  const maxDate = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]; })();

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
    // Enforce required intake fields configured in Settings
    const missing = enabledFields
      .filter(f => f.required && !(customerData[f.key]?.trim()))
      .map(f => getFieldLabel(f, locale as 'en' | 'fr' | 'ar'));
    if (missing.length > 0) {
      alert(`${t('Please fill required fields')}: ${missing.join(', ')}`);
      return;
    }
    setSubmitting(true);
    try {
      // Build customer_data from all enabled intake fields
      const cd: Record<string, any> = {};
      for (const f of enabledFields) {
        const val = customerData[f.key]?.trim();
        if (val) {
          // Map standard keys to expected column names
          if (f.key === 'reason') cd.reason_of_visit = val;
          else cd[f.key] = val;
        }
      }
      const result = await onBook({
        department_id: selectedDept,
        service_id: selectedService || undefined,
        customer_data: cd,
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
    setCustomerData({});
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
        background: 'var(--surface)',
        flex: 1, display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header bar with tabs */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '24px 16px 0', flexShrink: 0,
      }}>
        {/* Segmented toggle */}
        <div style={{
          position: 'relative', display: 'flex',
          background: 'var(--surface2, #1e293b)', borderRadius: 8, padding: 2,
          flex: 1,
        }}>
          {/* Sliding indicator */}
          <span style={{
            position: 'absolute', top: 2, bottom: 2,
            left: bookingTab === 'walkin' ? 2 : '50%',
            width: 'calc(50% - 2px)', borderRadius: 6,
            background: '#8b5cf6',
            transition: 'left 0.2s ease',
            zIndex: 0,
          }} />
          {(['walkin', 'future'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setBookingTab(tab)}
              style={{
                flex: 1, position: 'relative', zIndex: 1,
                padding: '6px 8px', border: 'none', borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
                background: 'transparent',
                color: bookingTab === tab ? '#fff' : 'var(--text3, #64748b)',
                transition: 'color 0.2s ease',
              }}
            >
              {tab === 'walkin' ? `🚶 ${t('Walk-in')}` : `📅 ${t('Future Booking')}`}
            </button>
          ))}
        </div>
        <button
          onClick={onCollapse}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text3)', fontSize: 14, padding: '4px 6px', borderRadius: 6,
            marginLeft: 6, flexShrink: 0,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
          title={t('Hide')}
        >
          ✕
        </button>
      </div>

      {/* QR Enlarged Overlay */}
      {enlargedQr && (
        <div
          onClick={() => setEnlargedQr(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16, padding: 24,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <img
              src={enlargedQr.url.replace('80x80', '300x300')}
              alt="QR" style={{ width: 260, height: 260, borderRadius: 8 }}
            />
            <div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{enlargedQr.label}</div>
            <button
              onClick={() => setEnlargedQr(null)}
              style={{
                padding: '6px 20px', border: 'none', borderRadius: 6,
                background: '#8b5cf6', color: '#fff', cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
              }}
            >{t('Close')}</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
      {bookingTab === 'future' ? (
        /* ── Future Booking Form — vertical stack for side panel ── */
        <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {futResult && (
            <div style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: futResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${futResult.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: futResult.success ? '#16a34a' : '#dc2626',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>{futResult.success ? `✓ ${t('Appointment booked')} — ${futResult.date} ${t('at')} ${futResult.time}` : `✗ ${futResult.error}`}</span>
              <button onClick={() => setFutResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: '0 4px' }}>✕</button>
            </div>
          )}

          {/* Department — hidden when there's only one (auto-selected). */}
          {departments.length > 1 && (
            <div>
              <label style={labelStyle}>{t('Department')} *</label>
              <select
                value={futDept}
                onChange={(e) => { setFutDept(e.target.value); setFutService(''); setFutSlots([]); setFutTime(''); }}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">{t('Select...')}</option>
                {departments.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Service */}
          {futDept && futDeptServices.length > 0 && (
            <div>
              <label style={labelStyle}>{t('Service')} *</label>
              <select
                value={futService}
                onChange={(e) => { setFutService(e.target.value); setFutSlots([]); setFutTime(''); }}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">{t('Select...')}</option>
                {futDeptServices.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date + Time Slot — 2-column row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('Date')} *</label>
              <DatePicker
                value={futDate}
                onChange={(e) => { setFutDate(e.target.value); setFutTime(''); }}
                min={today}
                max={maxDate}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('Time Slot')} *</label>
              {futSlotsLoading ? (
                <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: 'var(--text3)', fontSize: 11 }}>Loading...</div>
              ) : futSlots.length > 0 ? (
                <select
                  value={futTime}
                  onChange={(e) => {
                    // Guard: never accept a taken slot even if somehow selected.
                    const picked = futSlots.find(s => s.time === e.target.value);
                    if (picked && picked.available === false) return;
                    setFutTime(e.target.value);
                  }}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">{t('Select...')}</option>
                  {futSlots.map(slot => {
                    const takenLabel = slot.reason === 'daily_limit' ? t('full day') : t('taken');
                    return (
                      <option
                        key={slot.time}
                        value={slot.time}
                        disabled={!slot.available}
                        style={!slot.available ? { color: '#94a3b8' } : undefined}
                      >
                        {slot.time}{!slot.available ? ` — ${takenLabel}` : (slot.total > 1 ? ` (${slot.remaining}/${slot.total})` : '')}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: 'var(--text3)', fontSize: 11 }}>
                  {futDate && futService ? t('No slots available') : t('Select date & service')}
                </div>
              )}
            </div>
          </div>

          {/* Dynamic intake fields — same source of truth as walk-in tab +
              WhatsApp / Messenger / web booking. Admin's settings decide which
              fields appear. No hardcoded Name/Phone/Wilaya/Notes here. */}
          {enabledFields.map((field) => {
            const fLabel = getFieldLabel(field, locale as 'en' | 'fr' | 'ar');
            const isReq = field.key === 'name' || !!field.required;
            const fLabelReq = `${fLabel}${isReq ? ' *' : ''}`;
            const val = customerData[field.key] ?? '';

            if (field.key === 'name') return (
              <div key="fut-name" style={{ position: 'relative' }}>
                <label style={labelStyle}>{fLabelReq}</label>
                <input
                  type="text"
                  value={val}
                  onChange={(e) => { setField('name', e.target.value); setCustSearchQuery(e.target.value); }}
                  onFocus={() => { if (custSuggestions.length) setShowCustSuggestions(true); }}
                  onBlur={() => setTimeout(() => setShowCustSuggestions(false), 180)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleFutureBook(); if (e.key === 'Escape') setShowCustSuggestions(false); }}
                  placeholder={t('Search or type name')}
                  style={inputStyle}
                  autoComplete="off"
                />
                {bookingTab === 'future' && showCustSuggestions && custSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    marginTop: 4, maxHeight: 240, overflowY: 'auto',
                    background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #475569)',
                    borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                  }}>
                    {custSuggestions.map((c) => (
                      <div
                        key={c.id}
                        onMouseDown={(e) => { e.preventDefault(); pickCustomer(c); }}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border, #475569)',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.15)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.name || t('Unknown')}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', direction: 'ltr' }}>
                            {formatAlgPhoneLocal(c.phone)}{c.email ? ` · ${c.email}` : ''}
                          </div>
                        </div>
                        {(c.visit_count ?? 0) > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10, background: 'rgba(59,130,246,0.18)', color: '#3b82f6' }}>
                            {c.visit_count}× {t('Visits')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );

            if (field.key === 'phone') return (
              <div key="fut-phone">
                <label style={labelStyle}>{fLabelReq}</label>
                <input
                  type="tel"
                  value={val}
                  onChange={(e) => { setField('phone', e.target.value); setCustSearchQuery(e.target.value); }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleFutureBook(); }}
                  placeholder={t('Phone number')}
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>
            );

            if (field.key === 'wilaya') return (
              <div key="fut-wilaya">
                <label style={labelStyle}>{fLabelReq}</label>
                <select
                  value={val}
                  onChange={(e) => setField('wilaya', e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleFutureBook(); }}
                  style={inputStyle}
                >
                  <option value="">{fLabel}</option>
                  {WILAYAS.map(w => (
                    <option key={w.code} value={formatWilayaLabel(w, locale === 'ar')}>
                      {formatWilayaLabel(w, locale === 'ar')}
                    </option>
                  ))}
                </select>
              </div>
            );

            if (field.key === 'age') return (
              <div key="fut-age">
                <label style={labelStyle}>{fLabelReq}</label>
                <input
                  type="number"
                  min={1}
                  max={150}
                  value={val}
                  onChange={(e) => setField('age', e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleFutureBook(); }}
                  placeholder={fLabel}
                  style={inputStyle}
                />
              </div>
            );

            // Reason + custom fields — text input
            return (
              <div key={`fut-${field.key}`}>
                <label style={labelStyle}>{fLabelReq}</label>
                <input
                  type="text"
                  value={val}
                  onChange={(e) => setField(field.key, e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleFutureBook(); }}
                  placeholder={fLabel}
                  style={inputStyle}
                />
              </div>
            );
          })}

          {/* Submit — full width */}
          <button
            onClick={handleFutureBook}
            disabled={!futDept || !futService || !futDate || !futTime || !futName.trim() || futSubmitting}
            style={{
              width: '100%', padding: '8px 0', border: 'none', borderRadius: 6, marginTop: 2,
              background: (futDept && futService && futDate && futTime && futName.trim() && !futSubmitting) ? '#8b5cf6' : 'var(--surface2)',
              color: (futDept && futService && futDate && futTime && futName.trim() && !futSubmitting) ? '#fff' : 'var(--text3)',
              cursor: (futDept && futService && futDate && futTime && futName.trim() && !futSubmitting) ? 'pointer' : 'not-allowed',
              fontSize: 13, fontWeight: 700,
            }}
          >
            {futSubmitting ? '...' : t('Book Appointment')}
          </button>
        </div>
      ) : createdTicket ? (
        /* ── Ticket Created Confirmation — vertical for side panel ── */
        <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {/* Ticket info */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginBottom: 4 }}>✓ {t('Ticket Created')}</div>
            <div style={{
              fontSize: 28, fontWeight: 800, color: '#8b5cf6',
              background: 'rgba(139,92,246,0.1)', borderRadius: 8,
              padding: '8px 24px', lineHeight: 1.1,
            }}>
              {createdTicket.ticket_number}
            </div>
            {customerName.trim() && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{customerName.trim()}</div>}
            {whatsappStatus && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 4, fontSize: 10, marginTop: 6,
                background: whatsappStatus.sent ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                border: `1px solid ${whatsappStatus.sent ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
              }}>
                <span style={{ fontWeight: 600, color: whatsappStatus.sent ? '#16a34a' : '#d97706' }}>
                  {whatsappStatus.sent ? 'WhatsApp ✓' : 'WhatsApp ✗'}
                </span>
              </div>
            )}
          </div>

          {/* QR codes row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* Track QR */}
            <div
              onClick={() => setEnlargedQr({ url: `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(trackUrl)}`, label: t('Tracking QR') })}
              style={{ textAlign: 'center', cursor: 'pointer', padding: 6, borderRadius: 8, transition: 'background 0.15s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139,92,246,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              title={t('Click to enlarge')}
            >
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(trackUrl)}`}
                alt="QR" style={{ width: 56, height: 56, borderRadius: 6, border: '1px solid var(--border)' }}
              />
              <div style={{ fontSize: 9, fontWeight: 600, color: '#8b5cf6', marginTop: 3 }}>{t('Track')}</div>
            </div>

            {whatsappPhone && (
              <div
                onClick={() => setEnlargedQr({
                  url: `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`https://wa.me/${whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent('JOIN_' + createdTicket.qr_token)}`)}`,
                  label: 'WhatsApp',
                })}
                style={{ textAlign: 'center', cursor: 'pointer', padding: 6, borderRadius: 8, transition: 'background 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(37,211,102,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title={t('Click to enlarge')}
              >
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`https://wa.me/${whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent('JOIN_' + createdTicket.qr_token)}`)}`}
                  alt="WA" style={{ width: 56, height: 56, borderRadius: 6, border: '1px solid var(--border)' }}
                />
                <div style={{ fontSize: 9, fontWeight: 600, color: '#25D366', marginTop: 3 }}>WhatsApp</div>
              </div>
            )}

            {messengerPageId && (
              <div
                onClick={() => setEnlargedQr({
                  url: `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`https://m.me/${messengerPageId}?ref=JOIN_${createdTicket.qr_token}`)}`,
                  label: 'Messenger',
                })}
                style={{ textAlign: 'center', cursor: 'pointer', padding: 6, borderRadius: 8, transition: 'background 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,132,255,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title={t('Click to enlarge')}
              >
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`https://m.me/${messengerPageId}?ref=JOIN_${createdTicket.qr_token}`)}`}
                  alt="Msg" style={{ width: 56, height: 56, borderRadius: 6, border: '1px solid var(--border)' }}
                />
                <div style={{ fontSize: 9, fontWeight: 600, color: '#0084FF', marginTop: 3 }}>Messenger</div>
              </div>
            )}
          </div>

          {/* URL + New Ticket */}
          <div style={{ textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: 9, color: 'var(--text3)', wordBreak: 'break-all', lineHeight: 1.3, marginBottom: 8 }}>{trackUrl}</div>
            <button
              onClick={handleNewTicket}
              style={{
                width: '100%', padding: '8px 0', border: 'none', borderRadius: 6,
                background: '#8b5cf6', color: '#fff', cursor: 'pointer',
                fontSize: 12, fontWeight: 700,
              }}
            >
              + {t('New Ticket')}
            </button>
          </div>
        </div>
      ) : (
        /* ── Walk-in Booking Form — vertical stack for side panel ── */
        <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Department — hidden when there's only one (auto-selected via
              the effect above). No point forcing the operator to confirm
              a one-option dropdown. */}
          {departments.length > 1 && (
            <div>
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
          )}

          {/* Service */}
          {selectedDept && deptServices.length > 0 && (
            <div>
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

          {/* Dynamic intake fields rendered in configured order */}
          {enabledFields.map((field) => {
            const fLabel = getFieldLabel(field, locale as 'en' | 'fr' | 'ar');
            const isReq = !!field.required;
            const fLabelReq = `${fLabel}${isReq ? ' *' : ''}`;
            const val = customerData[field.key] ?? '';

            // Name field — with customer search autocomplete
            if (field.key === 'name') return (
              <div key="name" style={{ position: 'relative' }}>
                <label style={labelStyle}>{fLabelReq}</label>
                <input
                  ref={nameRef}
                  type="text"
                  value={val}
                  onChange={(e) => { setField('name', e.target.value); setCustSearchQuery(e.target.value); }}
                  onFocus={() => { if (custSuggestions.length) setShowCustSuggestions(true); }}
                  onBlur={() => setTimeout(() => setShowCustSuggestions(false), 180)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') setShowCustSuggestions(false); }}
                  placeholder={t('Search or type name')}
                  style={inputStyle}
                  autoComplete="off"
                />
                {bookingTab === 'walkin' && showCustSuggestions && custSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    marginTop: 4, maxHeight: 240, overflowY: 'auto',
                    background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #475569)',
                    borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                  }}>
                    {custSuggestions.map((c) => (
                      <div
                        key={c.id}
                        onMouseDown={(e) => { e.preventDefault(); pickCustomer(c); }}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border, #475569)',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.15)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.name || t('Unknown')}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', direction: 'ltr' }}>
                            {formatAlgPhoneLocal(c.phone)}{c.email ? ` · ${c.email}` : ''}
                          </div>
                        </div>
                        {(c.visit_count ?? 0) > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10, background: 'rgba(59,130,246,0.18)', color: '#3b82f6' }}>
                            {c.visit_count}× {t('Visits')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );

            // Phone field — with customer lookup trigger
            if (field.key === 'phone') return (
              <div key="phone">
                <label style={labelStyle}>{fLabelReq}</label>
                <input
                  type="tel"
                  value={val}
                  onChange={(e) => { setField('phone', e.target.value); setCustSearchQuery(e.target.value); }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSubmit(); }}
                  placeholder={t('Phone number')}
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>
            );

            // Wilaya field — dropdown
            if (field.key === 'wilaya') return (
              <div key="wilaya">
                <label style={labelStyle}>{fLabelReq}</label>
                <select
                  value={val}
                  onChange={(e) => setField('wilaya', e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSubmit(); }}
                  style={inputStyle}
                >
                  <option value="">{fLabel}</option>
                  {WILAYAS.map(w => (
                    <option key={w.code} value={formatWilayaLabel(w, locale === 'ar')}>
                      {formatWilayaLabel(w, locale === 'ar')}
                    </option>
                  ))}
                </select>
              </div>
            );

            // Age field — numeric input
            if (field.key === 'age') return (
              <div key="age">
                <label style={labelStyle}>{fLabelReq}</label>
                <input
                  type="number"
                  min={1}
                  max={150}
                  value={val}
                  onChange={(e) => setField('age', e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSubmit(); }}
                  placeholder={fLabel}
                  style={inputStyle}
                />
              </div>
            );

            // Reason + custom fields — text input
            return (
              <div key={field.key}>
                <label style={labelStyle}>{fLabelReq}</label>
                <input
                  type="text"
                  value={val}
                  onChange={(e) => setField(field.key, e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSubmit(); }}
                  placeholder={fLabel}
                  style={inputStyle}
                />
              </div>
            );
          })}

          {/* Customer lookup inline */}
          {lookupLoading && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{t('Looking up customer...')}</div>}
          {customerLookup && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              padding: '4px 10px', borderRadius: 6,
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
              fontSize: 11, color: 'var(--text)',
            }}>
              <span style={{ fontWeight: 600 }}>
                {t('Returning customer')} &bull; {t('{count} visits', { count: customerLookup.visits })}
              </span>
              {customerLookup.notes && <span style={{ color: 'var(--text2)', fontStyle: 'italic' }}>{customerLookup.notes}</span>}
            </div>
          )}

          {/* Priority + Submit — full width row */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 2 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={isPriority} onChange={(e) => setIsPriority(e.target.checked)} style={{ width: 14, height: 14, accentColor: '#f59e0b' }} />
              {t('Priority')}
            </label>
            <button
              onClick={handleSubmit}
              disabled={!selectedDept || submitting}
              style={{
                flex: 1, padding: '8px 0', border: 'none', borderRadius: 6,
                background: (selectedDept && !submitting) ? '#8b5cf6' : 'var(--surface2)',
                color: (selectedDept && !submitting) ? '#fff' : 'var(--text3)',
                cursor: (selectedDept && !submitting) ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 700,
              }}
            >
              {submitting ? '...' : t('Create Ticket')}
            </button>
          </div>
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
const DEFAULT_CALL_TIMEOUT = 60; // 1 minute in seconds (matches org settings default)
const FALLBACK_POLL_INTERVAL = 10000; // 10s fallback (event-driven is primary)
const DEVICE_CHECK_INTERVAL = 5000;

type StaffStatus = 'available' | 'on_break' | 'away';

const STAFF_STATUS_LABELS: Record<StaffStatus, { label: string; color: string; icon: string }> = {
  available: { label: 'Available', color: '#22c55e', icon: '●' },
  on_break: { label: 'On Break', color: '#f59e0b', icon: '◐' },
  away: { label: 'Away', color: '#ef4444', icon: '○' },
};

/** @deprecated — use getDayNameFromKey(dateKeyInTz(now, tz)) instead */
const DAYS_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeOfficeTimezone(timezone: string | null | undefined) {
  const value = (timezone ?? '').trim();
  if (!value) return '';
  if (value === 'UTC') return ''; // Don't accept UTC as a valid office timezone
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

/** Extract custom intake fields from customer_data (excludes known system keys) */
function getCustomIntakeFields(customerData: unknown): [string, string][] {
  if (!customerData || typeof customerData !== 'object' || Array.isArray(customerData)) return [];
  const data = customerData as Record<string, unknown>;
  const systemKeys = new Set([
    'name', 'full_name', 'customer_name', 'patient_name', 'guest_name', 'party_name',
    'phone', 'customer_phone', 'email', 'customer_email',
    'source', 'messenger_psid', 'whatsapp_phone',
    'wilaya', 'reason', 'reason_of_visit',
  ]);
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (systemKeys.has(key)) continue;
    if (typeof value === 'string' && value.trim()) {
      entries.push([key, value.trim()]);
    }
  }
  return entries;
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

        // Use dateKey → getDayNameFromKey for timezone-safe day resolution
        const todayKey = tz ? dateKeyInTz(now, tz) : now.toISOString().split('T')[0];
        const day = getDayNameFromKey(todayKey);
        let time: string;
        try {
          const tf = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
          const parts = tf.formatToParts(now);
          time = `${(parts.find(p => p.type === 'hour')?.value ?? '00').padStart(2, '0')}:${(parts.find(p => p.type === 'minute')?.value ?? '00').padStart(2, '0')}`;
        } catch {
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
          // Find next open — use CALENDAR_DAYS (Mon-based) for consistency
          const di = CALENDAR_DAYS.indexOf(day as typeof CALENDAR_DAYS[number]);
          let next: any;
          for (let o = 1; o <= 7; o++) {
            const d = CALENDAR_DAYS[(di + o) % 7];
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
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: locale === 'ar' ? 'none' as const : 'uppercase' as const, letterSpacing: locale === 'ar' ? 'normal' : 1, marginBottom: 6 }}>
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

function RemoteSupportSection({ t, locale }: { t: (key: string, values?: Record<string, string | number | null | undefined>) => string; locale: DesktopLocale }) {
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
        type="button"
        onClick={() => setShowSupport((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          padding: '6px 0', border: 'none', background: 'transparent', cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: locale === 'ar' ? 'none' as const : 'uppercase' as const, letterSpacing: locale === 'ar' ? 'normal' : 1, margin: 0, pointerEvents: 'none' }}>
          {t('Remote Support')}
        </h4>
        <span style={{ fontSize: 12, color: 'var(--text3)', minWidth: 24, minHeight: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>{showSupport ? '▲' : '▼'}</span>
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
  const BOOKING_WIDTH_KEY = 'qflo_station_booking_width';
  const SHOW_ACTIVITY_KEY = 'qflo_station_show_activity';
  const SHOW_DEVICES_KEY = 'qflo_station_show_devices';
  const MIN_SIDEBAR_WIDTH = 320;
  const MAX_SIDEBAR_WIDTH = 720;
  const MIN_BOOKING_WIDTH = 300;
  const MAX_BOOKING_WIDTH = 600;
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

  const { confirm: styledConfirm } = useConfirmDialog();
  // ── DB recovery banner ────────────────────────────────────────────
  // Shown once per session when startup recovered from a corrupt local
  // DB. Dismiss is stored in sessionStorage so it doesn't re-appear on
  // window focus/route changes in the same run. On next launch, if the
  // new DB is healthy, the banner simply doesn't show.
  const [dbRecovery, setDbRecovery] = useState<null | { action: string; fromBackup?: string; reason?: string }>(null);
  useEffect(() => {
    if (sessionStorage.getItem('qflo_db_recovery_dismissed') === '1') return;
    let cancelled = false;
    (async () => {
      try {
        const r = await window.qf?.db?.recoveryStatus?.();
        if (!cancelled && r && r.action && r.action !== 'healthy') setDbRecovery(r);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

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
  const [showCustomersModal, setShowCustomersModal] = useState(false);
  const [customerPhoneToOpen, setCustomerPhoneToOpen] = useState<string | undefined>();
  // showAppointmentsModal removed — unified into CalendarModal
  const [officeTimezone, setOfficeTimezone] = useState<string>('Africa/Algiers');
  const [orgSettings, setOrgSettings] = useState<Record<string, any>>({});
  const [callTimeoutSeconds, setCallTimeoutSeconds] = useState(DEFAULT_CALL_TIMEOUT);
  const [settingsVersion, setSettingsVersion] = useState(0);
  useEffect(() => {
    if (!session.office_id) return;
    let cancelled = false;
    (async () => {
      try {
        // Fetch org-level timezone + settings (single source of truth for the business)
        let tz = '';
        try {
          const { ensureAuth } = await import('../lib/supabase');
          const { getSupabase } = await import('../lib/supabase');
          await ensureAuth();
          const sb = await getSupabase();
          // Get org timezone + settings via the organization_id
          const { data: orgData } = await sb.from('organizations').select('timezone, settings').eq('id', session.organization_id).single();
          if (orgData?.timezone) tz = normalizeOfficeTimezone(orgData.timezone);
          // Read auto_no_show_timeout (stored in minutes)
          const fetchedOrgSettings = (orgData?.settings ?? {}) as Record<string, any>;
          if (!cancelled) setOrgSettings(fetchedOrgSettings);
          const timeoutMinutes = Number(fetchedOrgSettings.auto_no_show_timeout);
          if (!cancelled && timeoutMinutes > 0) setCallTimeoutSeconds(timeoutMinutes * 60);
        } catch {}
        // Fallback: try local SQLite office timezone
        if (!tz) {
          const rows: any[] = (await window.qf?.db?.query?.('offices', [session.office_id])) ?? [];
          tz = normalizeOfficeTimezone(rows?.[0]?.timezone);
        }
        if (!cancelled && tz) setOfficeTimezone(tz);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [session.organization_id, settingsVersion]);
  // storedAuth kept as empty stub for prop compatibility — ensureAuth() uses IPC (pure token auth v1.8.0)
  const storedAuth = useMemo(() => ({}), []);
  // Today's counter + RDV side panel
  const [todayStats, setTodayStats] = useState<{ walkins: number; rdv: number }>({ walkins: 0, rdv: 0 });
  const [todayAppointments, setTodayAppointments] = useState<Array<{ id: string; customer_name: string | null; customer_phone: string | null; scheduled_at: string; status: string; wilaya: string | null; notes: string | null; service_id: string | null; department_id: string | null; source: string | null }>>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<Array<{ id: string; customer_name: string | null; customer_phone: string | null; scheduled_at: string; status: string; wilaya: string | null; notes: string | null; service_id: string | null; department_id: string | null; source: string | null }>>([]);
  const [queueTab, setQueueTab] = useState<'queue' | 'rdv' | 'pending'>('queue');
  const [rdvBusyId, setRdvBusyId] = useState<string | null>(null);
  const [pendingTickets, setPendingTickets] = useState<Array<{ id: string; ticket_number: string; source: string | null; customer_data: any; created_at: string; department_id: string | null; service_id: string | null }>>([]);
  const [pendingBusyId, setPendingBusyId] = useState<string | null>(null);
  const [expandedPendingId, setExpandedPendingId] = useState<string | null>(null);
  const prevPendingCount = useRef(0);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showBusinessAdminModal, setShowBusinessAdminModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calendarInitialView, setCalendarInitialView] = useState<'week' | 'month' | 'list'>('week');
  const [calendarInitialApptId, setCalendarInitialApptId] = useState<string | null>(null);
  // Main view: 'queue' shows active ticket/idle, 'calendar' shows embedded calendar, 'customers' shows embedded customer list
  const [mainView, setMainView] = useState<'queue' | 'calendar' | 'customers'>('calendar');
  // Track which tabs have been visited — mount once, then keep alive (no flash on revisit)
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set(['queue']));
  // Refresh counters — increment on each tab switch to trigger silent data reload
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [customersRefreshKey, setCustomersRefreshKey] = useState(0);
  useEffect(() => {
    setMountedTabs(prev => prev.has(mainView) ? prev : new Set(prev).add(mainView));
    if (mainView === 'calendar') setCalendarRefreshKey(k => k + 1);
    if (mainView === 'customers') setCustomersRefreshKey(k => k + 1);
  }, [mainView]);
  // Listen for native File > Settings menu click
  useEffect(() => {
    const off = (window as any).qf?.settings?.onOpenSettings?.(() => setShowSettingsModal(true));
    const offTeam = (window as any).qf?.settings?.onOpenTeam?.(() => setShowTeamModal(true));
    const offBiz = (window as any).qf?.settings?.onOpenBusinessAdmin?.(() => setShowBusinessAdminModal(true));
    return () => {
      if (typeof off === 'function') off();
      if (typeof offTeam === 'function') offTeam();
      if (typeof offBiz === 'function') offBiz();
    };
  }, []);
  const [bookingPrefill, setBookingPrefill] = useState<{ name?: string; phone?: string; notes?: string; wilaya?: string; futureDate?: string; futureTime?: string; _ts?: number } | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState<{ fr: string; ar: string }>({ fr: '', ar: '' });
  const [broadcastLang, setBroadcastLang] = useState<'fr' | 'ar'>('fr');
  const [broadcastTemplates, setBroadcastTemplates] = useState<any[]>([]);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{ sent: number; failed?: number; error?: string } | null>(null);
  const [broadcastShowSave, setBroadcastShowSave] = useState(false);
  const [broadcastTemplateName, setBroadcastTemplateName] = useState('');
  const [broadcastTemplateShortcut, setBroadcastTemplateShortcut] = useState('');
  const [showNotesField, setShowNotesField] = useState(false);
  const [ticketNotes, setTicketNotes] = useState('');
  const [priorityDropdownId, setPriorityDropdownId] = useState<string | null>(null);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const [allServices, setAllServices] = useState<{ id: string; name: string; department_id: string; color?: string | null; estimated_service_time?: number }[]>([]);
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
  /**
   * Return a color/weight style for a ticket's wait time so operators can
   * spot overdue tickets at a glance instead of reading the number.
   *   < 15 min → muted (normal)
   *  15–60 min → warning yellow
   *   > 60 min → danger red, bold
   */
  const waitStyle = useCallback((dateStr: string): React.CSSProperties => {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000));
    if (mins > 60) return { color: '#ef4444', fontWeight: 700 };
    if (mins >= 15) return { color: '#f59e0b', fontWeight: 600 };
    return {};
  }, []);
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

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), type === 'error' ? 5000 : 3500);
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
      showToast(translate(locale, 'Port {requested} was in use — running on port {actual}', { requested: info.requested, actual: info.actual }), 'info');
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
        setAllServices((svcs ?? []).map((s: any) => ({ id: s.id, name: s.name, department_id: s.department_id, color: s.color ?? null, estimated_service_time: s.estimated_service_time ?? 30 })));
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

  // ── Auth recovery: re-fetch all data when token refreshes (cold start fix) ──
  useEffect(() => {
    const unsub = window.qf.auth?.onTokenRefreshed?.(() => {
      // Token was refreshed — re-fetch appointment data that may have failed on cold start
      fetchTodayRef.current();
      fetchTickets();
    });
    return () => { unsub?.(); };
  }, [fetchTickets]);

  // ── Sync error notifications ───────────────────────────────────
  useEffect(() => {
    const unsub = window.qf.sync?.onError?.((error: { message: string; ticketNumber?: string; type: string }) => {
      showToast(error.message, 'error');
    });
    return () => { unsub?.(); };
  }, [showToast]);

  // ── Notification result feedback (from direct /api/ticket-transition) ──
  useEffect(() => {
    const unsub = window.qf.notify?.onResult?.((result: { ticketId: string; sent: boolean; channel?: string; error?: string }) => {
      if (result.sent) {
        showToast(translate(locale, 'Customer notified via {channel}', { channel: result.channel || 'message' }), 'success');
      } else if (result.error === 'no_session') {
        // No WhatsApp session — customer walked in without scanning QR, this is normal
      } else if (result.error === 'network_error' || result.error === 'token_error') {
        showToast(translate(locale, 'Notification delayed — will retry via sync'), 'info');
      }
    });
    return () => { unsub?.(); };
  }, [showToast, locale]);

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

  // ── Today's counter + RDV side panel data ──────────────────────
  const fetchTodayRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!session.office_id) return;
    let cancelled = false;

    // Load cached appointments from SQLite FIRST so the calendar is never blank
    (async () => {
      try {
        const raw = await window.qf.cache?.getAppointments?.(session.office_id);
        if (raw && !cancelled) {
          const cached = JSON.parse(raw);
          if (cached?.today?.length) setTodayAppointments(cached.today);
          if (cached?.upcoming?.length) setUpcomingAppointments(cached.upcoming);
          if (cached?.stats) setTodayStats(cached.stats);
        }
      } catch {}
    })();

    const fetchToday = async (retryCount = 0) => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        // Anchor "today" to the OFFICE's local day, not the Station machine's
        // local day. Otherwise an operator running the Station from a different
        // timezone sees zero RDVs for "today" while the customer has them.
        const tz = officeTimezone;
        const partsNow = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(new Date());
        const yyyy = partsNow.find(p => p.type === 'year')?.value ?? '1970';
        const mm = partsNow.find(p => p.type === 'month')?.value ?? '01';
        const dd = partsNow.find(p => p.type === 'day')?.value ?? '01';
        const probe = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
        const probeParts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(probe);
        const get = (k: string) => Number(probeParts.find(p => p.type === k)?.value ?? '0');
        const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
        const start = new Date(probe.getTime() - (asUtc - probe.getTime()));
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        // Walk-in count: tickets created today via station/whatsapp/etc (exclude appointment check-ins to avoid double count? we'll count all tickets and subtract appointments-from-checkins)
        const [ticketRes, apptsRes, upcomingRes] = await Promise.all([
          sb.from('tickets').select('id', { count: 'exact', head: true }).eq('office_id', session.office_id).gte('created_at', startIso).lt('created_at', endIso),
          sb.from('appointments').select('id, customer_name, customer_phone, scheduled_at, status, wilaya, notes, service_id, department_id, source').eq('office_id', session.office_id).gte('scheduled_at', startIso).lt('scheduled_at', endIso).neq('status', 'cancelled').order('scheduled_at', { ascending: true }).limit(200),
          sb.from('appointments').select('id, customer_name, customer_phone, scheduled_at, status, wilaya, notes, service_id, department_id, source').eq('office_id', session.office_id).gte('scheduled_at', endIso).neq('status', 'cancelled').order('scheduled_at', { ascending: true }).limit(200),
        ]);
        if (cancelled) return;
        // GUARD: if Supabase returned null (auth error / RLS block), do NOT wipe existing state
        if (apptsRes.data === null || upcomingRes.data === null) {
          console.warn('[Station] RDV fetch returned null — auth may have expired, keeping existing data');
          return;
        }
        const rdvList = apptsRes.data as any[];
        const stats = { walkins: Math.max(0, (ticketRes.count || 0)), rdv: rdvList.length };
        setTodayAppointments(rdvList);
        setUpcomingAppointments(upcomingRes.data as any[]);
        setTodayStats(stats);
        // Cache to SQLite so data survives auth failures / app restarts
        try {
          window.qf.cache?.saveAppointments?.(session.office_id, JSON.stringify({
            today: rdvList,
            upcoming: upcomingRes.data,
            stats,
            cachedAt: new Date().toISOString(),
          }));
        } catch {}
      } catch (e) {
        if (!cancelled) {
          console.warn('[Station] today stats fetch failed', e);
          // Retry up to 3 times with exponential backoff on initial load failure
          if (retryCount < 3) {
            const delay = Math.min(2000 * Math.pow(2, retryCount), 10000);
            setTimeout(() => { if (!cancelled) fetchToday(retryCount + 1); }, delay);
          }
        }
      }
    };
    fetchTodayRef.current = fetchToday;
    fetchToday();
    // Realtime subscription — instant refresh when any appointment changes
    let rdvChannel: any;
    getSupabase().then((sb) => {
      if (cancelled) return;
      rdvChannel = sb.channel(`station-rdv-${session.office_id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `office_id=eq.${session.office_id}` },
          () => { fetchToday(); })
        .subscribe();
    });
    const iv = setInterval(fetchToday, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      if (rdvChannel) getSupabase().then((sb) => sb.removeChannel(rdvChannel));
    };
  }, [session.office_id, storedAuth, officeTimezone]);

  // ── Auth health monitor — detect & recover from broken auth ────
  // Runs every 2 minutes. If auth is silently broken (expired token,
  // lost refresh_token), aggressively re-requests from main process
  // and re-fetches data so the operator never sees blank screens.
  useEffect(() => {
    if (!session.office_id) return;
    const checkAuth = async () => {
      const ok = await verifyAuthWorks();
      if (!ok) {
        console.warn('[Station] Auth health check FAILED — attempting recovery...');
        const token = await ensureAuth();
        if (token) {
          console.info('[Station] Auth recovered — refreshing data');
          fetchTickets();
          fetchTodayRef.current();
        } else {
          console.error('[Station] Auth recovery FAILED — showing cached data');
        }
      }
    };
    const iv = setInterval(checkAuth, 120_000); // every 2 minutes
    return () => clearInterval(iv);
  }, [session.office_id, fetchTickets]);

  // ── Pending approval tickets (realtime + initial fetch) ────────
  useEffect(() => {
    if (!session.office_id) return;
    let cancelled = false;
    let channel: any;
    const fetchPending = async (retryCount = 0) => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        const { data, error } = await sb
          .from('tickets')
          .select('id, ticket_number, source, customer_data, created_at, department_id, service_id')
          .eq('office_id', session.office_id)
          .eq('status', 'pending_approval')
          .order('created_at', { ascending: true })
          .limit(200);
        if (cancelled) return;
        if (data === null) {
          console.warn('[Station] pending tickets fetch returned null — auth may have expired', error);
          return;
        }
        const list = data as any[];
        // Notify on new pending arrivals
        if (list.length > prevPendingCount.current && prevPendingCount.current > 0) {
          showToast(translate(locale, '{n} new ticket(s) awaiting approval', { n: list.length - prevPendingCount.current }), 'info');
          try { new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQBvAAAA').play().catch(() => {}); } catch {}
        }
        prevPendingCount.current = list.length;
        setPendingTickets(list);
      } catch (e) {
        if (!cancelled) {
          console.warn('[Station] pending tickets fetch failed', e);
          // Retry up to 3 times with exponential backoff
          if (retryCount < 3) {
            const delay = Math.min(2000 * Math.pow(2, retryCount), 10000);
            setTimeout(() => { if (!cancelled) fetchPending(retryCount + 1); }, delay);
          }
        }
      }
    };
    fetchPending();
    // Supabase realtime subscription for pending approval changes
    getSupabase().then((sb) => {
      if (cancelled) return;
      channel = sb.channel(`pending-tickets-${session.office_id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `office_id=eq.${session.office_id}` },
          () => { fetchPending(); })
        .subscribe();
    });
    const iv = setInterval(fetchPending, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      if (channel) getSupabase().then((sb) => sb.removeChannel(channel));
    };
  }, [session.office_id, storedAuth, locale]);

  // ── Lifecycle-derived appointment buckets ─────────────────────
  // RDV tab = confirmed today + confirmed upcoming grouped by date
  // Pending tab = ALL pending appointments (any future date) + pending tickets
  const confirmedAppointments = useMemo(
    () => todayAppointments.filter((a) => a.status === 'confirmed'),
    [todayAppointments],
  );
  const confirmedUpcoming = useMemo(
    () => upcomingAppointments.filter((a) => a.status === 'confirmed'),
    [upcomingAppointments],
  );
  const upcomingByDate = useMemo(() => {
    const groups: Record<string, typeof confirmedUpcoming> = {};
    const tz = officeTimezone;
    for (const a of confirmedUpcoming) {
      const dateLabel = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-US' : 'fr-FR', {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
      }).format(new Date(a.scheduled_at));
      if (!groups[dateLabel]) groups[dateLabel] = [];
      groups[dateLabel].push(a);
    }
    return groups;
  }, [confirmedUpcoming, officeTimezone, locale]);
  const totalRdvCount = confirmedAppointments.length + confirmedUpcoming.length;
  // Track which upcoming date sections are expanded
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  // ── Pending appointments for ALL future dates (not just today) ──
  // Approval inbox: a customer who books for next Tuesday must appear here
  // immediately so the provider can approve before their day arrives.
  type PendingAppt = {
    id: string;
    customer_name: string | null;
    customer_phone: string | null;
    scheduled_at: string;
    status: string;
    wilaya: string | null;
    notes: string | null;
    service_id: string | null;
    department_id: string | null;
  };
  const [pendingAppointmentsAll, setPendingAppointmentsAll] = useState<PendingAppt[]>([]);

  useEffect(() => {
    if (!session.office_id) return;
    let cancelled = false;
    let channel: any;
    const fetchPendingAppts = async () => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        const nowIso = new Date().toISOString();
        const { data, error } = await sb
          .from('appointments')
          .select('id, customer_name, customer_phone, scheduled_at, status, wilaya, notes, service_id, department_id')
          .eq('office_id', session.office_id)
          .eq('status', 'pending')
          .gte('scheduled_at', nowIso)
          .order('scheduled_at', { ascending: true })
          .limit(500);
        if (cancelled) return;
        if (data === null) {
          console.warn('[Station] pending appts fetch returned null — auth may have expired', error);
          return;
        }
        setPendingAppointmentsAll(data as PendingAppt[]);
      } catch (e) {
        if (!cancelled) console.warn('[Station] pending appointments fetch failed', e);
      }
    };
    fetchPendingAppts();
    getSupabase().then((sb) => {
      if (cancelled) return;
      channel = sb.channel(`pending-appts-${session.office_id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `office_id=eq.${session.office_id}` },
          () => { fetchPendingAppts(); })
        .subscribe();
    });
    const iv = setInterval(fetchPendingAppts, 15_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      if (channel) getSupabase().then((sb) => sb.removeChannel(channel));
    };
  }, [session.office_id, storedAuth]);

  // Split pending appointments by today vs upcoming using office timezone
  const { pendingApptsToday, pendingApptsUpcoming } = useMemo(() => {
    const tz = officeTimezone;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayKey = fmt.format(new Date());
    const today: PendingAppt[] = [];
    const upcoming: PendingAppt[] = [];
    for (const a of pendingAppointmentsAll) {
      if (fmt.format(new Date(a.scheduled_at)) === todayKey) today.push(a);
      else upcoming.push(a);
    }
    return { pendingApptsToday: today, pendingApptsUpcoming: upcoming };
  }, [pendingAppointmentsAll, officeTimezone]);

  // Group upcoming by date label for layout
  const pendingApptsUpcomingGrouped = useMemo(() => {
    const tz = officeTimezone;
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const dayLabel = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : locale === 'en' ? 'en-GB' : 'fr-FR', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'short',
    });
    const groups = new Map<string, { label: string; items: PendingAppt[] }>();
    for (const a of pendingApptsUpcoming) {
      const d = new Date(a.scheduled_at);
      const key = dayKey.format(d);
      if (!groups.has(key)) groups.set(key, { label: dayLabel.format(d), items: [] });
      groups.get(key)!.items.push(a);
    }
    return Array.from(groups.values());
  }, [pendingApptsUpcoming, officeTimezone, locale]);

  const pendingTotalCount = pendingTickets.length + pendingAppointmentsAll.length;

  const updateTicketStatus = useCallback(async (ticketId: string, updates: Record<string, any>) => {
    try {
      const result = await window.qf.db.updateTicket(ticketId, updates);
      if (updates.status === 'called' && !result) {
        showToast(t('Ticket already called by another desk'), 'error');
      }
      fetchTickets();
    } catch (err: any) {
      showToast(t('Failed to update ticket'), 'error');
      console.error('[station] updateTicket error:', err);
    }
  }, [showToast, t, fetchTickets]);

  // ── Unified appointment action: ALL appointment operations go through the API ──
  const moderateAppointment = useCallback(async (
    apptId: string,
    action: 'approve' | 'decline' | 'cancel' | 'no_show' | 'check_in' | 'call' | 'serve' | 'complete' | 'delete',
    opts?: { reason?: string },
  ): Promise<boolean> => {
    setRdvBusyId(apptId);
    try {
      const token = await ensureAuth();

      // ── Ticket-level actions: reuse existing queue path for instant local update ──
      // For call/serve/complete/no_show/cancel — find linked ticket and update locally
      // This ensures the queue sidebar updates immediately (no waiting for cloud sync)
      // ── Delete: goes straight to API, also removes local linked ticket ──
      if (action === 'delete') {
        // Remove any local linked ticket first
        try {
          const localTickets = await window.qf.db.getTickets(session.office_ids ?? [session.office_id], ['waiting', 'called', 'serving']);
          const linkedTicket = localTickets.find((t: any) => t.appointment_id === apptId);
          if (linkedTicket) {
            updateTicketStatus(linkedTicket.id, { status: 'cancelled' });
          }
        } catch { /* non-critical */ }

        // Call API to delete from cloud
        const res = await cloudFetch('https://qflo.net/api/moderate-appointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ appointmentId: apptId, action: 'delete' }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        // Remove from all local state
        setTodayAppointments((prev) => prev.filter((a) => a.id !== apptId));
        setUpcomingAppointments((prev) => prev.filter((a) => a.id !== apptId));
        setPendingAppointmentsAll((prev) => prev.filter((a) => a.id !== apptId));
        showToast(translate(locale, 'Appointment deleted'), 'success');
        setRdvBusyId(null);
        return true;
      }

      if (action === 'call' || action === 'serve' || action === 'complete' || action === 'no_show' || action === 'cancel') {
        const localTickets = await window.qf.db.getTickets(session.office_ids ?? [session.office_id], ['waiting', 'called', 'serving']);
        const linkedTicket = localTickets.find((t: any) => t.appointment_id === apptId && !['served', 'no_show', 'cancelled'].includes(t.status));

        // For call/serve/complete, a linked ticket MUST exist (post-check-in)
        if ((action === 'call' || action === 'serve' || action === 'complete') && !linkedTicket) {
          throw new Error('No active ticket found for this appointment');
        }

        if (action === 'call') {
          if (!session.desk_id) throw new Error('No desk assigned');
          updateTicketStatus(linkedTicket.id, {
            status: 'called',
            desk_id: session.desk_id,
            called_at: new Date().toISOString(),
            called_by_staff_id: session.staff_id || undefined,
          });
          setTodayAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status: 'called' as any } : a));
          showToast(translate(locale, 'Called to desk'), 'success');
          setRdvBusyId(null);
          return true;
        } else if (action === 'serve') {
          updateTicketStatus(linkedTicket.id, {
            status: 'serving',
            serving_started_at: new Date().toISOString(),
          });
          setTodayAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status: 'serving' as any } : a));
          showToast(translate(locale, 'Service started'), 'success');
          setRdvBusyId(null);
          return true;
        } else if (action === 'complete') {
          // Mark ticket served locally (same path as queue Complete button)
          updateTicketStatus(linkedTicket.id, {
            status: 'served',
            completed_at: new Date().toISOString(),
          });
          // Also update appointment status to completed directly via Supabase
          // (skip moderate-appointment API to avoid double notifications — ticket-transition handles notifs)
          // Precondition: only update if still in an active state (prevents race with other users)
          getSupabase().then((sb) => {
            sb.from('appointments').update({ status: 'completed' }).eq('id', apptId).in('status', ['confirmed', 'checked_in', 'serving']).then(() => {});
          }).catch(() => { /* non-critical */ });
          setTodayAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status: 'completed' as any } : a));
          showToast(translate(locale, 'Appointment completed'), 'success');
          setRdvBusyId(null);
          return true;
        } else if ((action === 'no_show' || action === 'cancel') && linkedTicket) {
          // Ticket exists (post-check-in): update locally for instant queue removal
          const ticketStatus = action === 'no_show' ? 'no_show' : 'cancelled';
          updateTicketStatus(linkedTicket.id, { status: ticketStatus });
          // Update appointment via Supabase directly (lifecycle handles notifications)
          // Precondition: only update if still in an active state (prevents race with other users)
          getSupabase().then((sb) => {
            sb.from('appointments').update({ status: action === 'no_show' ? 'no_show' : 'cancelled' }).eq('id', apptId).in('status', ['pending', 'confirmed', 'checked_in', 'serving']).then(() => {});
          }).catch(() => { /* non-critical */ });
          setTodayAppointments((prev) => prev.filter((a) => a.id !== apptId));
          setUpcomingAppointments((prev) => prev.filter((a) => a.id !== apptId));
          showToast(translate(locale, action === 'no_show' ? 'Marked no-show' : 'Appointment cancelled'), 'success');
          setRdvBusyId(null);
          return true;
        }
        // cancel/no_show without linked ticket: fall through to API path below
      }

      // ── All other actions go through /api/moderate-appointment ──
      const payload: any = { appointmentId: apptId, action };
      if (opts?.reason) payload.reason = opts.reason;
      const res = await cloudFetch('https://qflo.net/api/moderate-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json().catch(() => ({} as any));

      // ── Update local state based on action ──
      const removeFromPending = () => setPendingAppointmentsAll((prev) => prev.filter((a) => a.id !== apptId));
      switch (action) {
        case 'approve': {
          // Find the appointment in pending list BEFORE removing it, so we can add it to the correct list
          const approvedAppt = pendingAppointmentsAll.find((a) => a.id === apptId);
          removeFromPending();
          // Update today list if already present
          setTodayAppointments((prev) => {
            const existing = prev.find((a) => a.id === apptId);
            if (existing) return prev.map((a) => a.id === apptId ? { ...a, status: 'confirmed' } : a);
            // If NOT in today's list, check if the approved date falls today — add it
            if (approvedAppt) {
              const apptDate = new Date(approvedAppt.scheduled_at).toDateString();
              const todayDate = new Date().toDateString();
              if (apptDate === todayDate) {
                return [...prev, { ...approvedAppt, status: 'confirmed', source: null }].sort(
                  (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
                );
              }
            }
            return prev;
          });
          // Also add to upcoming if it's a future appointment
          if (approvedAppt) {
            const apptDate = new Date(approvedAppt.scheduled_at).toDateString();
            const todayDate = new Date().toDateString();
            if (apptDate !== todayDate) {
              setUpcomingAppointments((prev) => {
                const existing = prev.find((a) => a.id === apptId);
                if (existing) return prev.map((a) => a.id === apptId ? { ...a, status: 'confirmed' } : a);
                return [...prev, { ...approvedAppt, status: 'confirmed', source: null }].sort(
                  (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
                );
              });
            }
          }
          break;
        }
        case 'decline':
          removeFromPending();
          setTodayAppointments((prev) => prev.filter((a) => a.id !== apptId));
          setUpcomingAppointments((prev) => prev.filter((a) => a.id !== apptId));
          break;
        case 'cancel':
        case 'no_show':
          setTodayAppointments((prev) => prev.filter((a) => a.id !== apptId));
          setUpcomingAppointments((prev) => prev.filter((a) => a.id !== apptId));
          break;
        case 'check_in':
          // Insert cloud-returned ticket into local SQLite for immediate queue display
          if (result.ticket) {
            await window.qf.db.insertCloudTicket(result.ticket);
            fetchTickets();
          }
          setTodayAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status: 'checked_in' } : a));
          break;
        // complete, call, serve handled above — won't reach the switch
      }

      // ── Toast feedback ──
      const notified = result?.notified === true;
      const toastKey: Record<string, string> = {
        approve: notified ? 'Appointment approved — customer notified' : 'Appointment approved — customer not reachable on chat',
        decline: notified ? 'Appointment declined — customer notified' : 'Appointment declined — customer not reachable on chat',
        cancel: 'Appointment cancelled',
        no_show: 'Appointment marked no-show',
        check_in: result.ticket ? 'Checked in — {ticket}' : 'Checked in',
        complete: 'Appointment completed',
      };
      const toastParams: Record<string, string | number | null | undefined> | undefined =
        action === 'check_in' && result.ticket ? { ticket: result.ticket.ticket_number } : undefined;
      showToast(translate(locale, toastKey[action] || 'Done', toastParams), notified ? 'success' : 'info');
      return true;
    } catch (e: any) {
      showToast(e?.message || translate(locale, 'Failed'), 'error');
      return false;
    } finally {
      setRdvBusyId(null);
    }
  }, [locale, showToast, storedAuth, fetchTickets, pendingAppointmentsAll, session.desk_id, session.staff_id, session.office_id, session.office_ids, updateTicketStatus]);

  // Render a single pending-appointment card (used in Today + Upcoming sections)
  const renderPendingApptCard = useCallback((a: PendingAppt, opts?: { showDate?: boolean }) => {
    const tz = officeTimezone;
    const timeStr = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(a.scheduled_at));
    const dateStr = opts?.showDate
      ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : locale === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: 'short', timeZone: tz }).format(new Date(a.scheduled_at))
      : '';
    const fullDateStr = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : locale === 'en' ? 'en-GB' : 'fr-FR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: tz,
    }).format(new Date(a.scheduled_at));
    const svcName = (a.service_id && names.services?.[a.service_id]) || '';
    const deptName = (a.department_id && names.departments?.[a.department_id]) || '';
    const busy = rdvBusyId === a.id;
    const expKey = `appt-${a.id}`;
    const isExpanded = expandedPendingId === expKey;
    return (
      <div key={a.id} style={{
        padding: '6px 8px',
        background: isExpanded ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.35)',
        borderLeft: '3px solid #f59e0b',
        borderRadius: 6,
        opacity: busy ? 0.55 : 1,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          onClick={() => setExpandedPendingId(prev => prev === expKey ? null : expKey)}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: 1.2 }}>
              <span style={{ fontSize: 8, color: 'var(--text3, #94a3b8)', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
              <span style={{ fontWeight: 800, color: 'var(--text, #f1f5f9)', fontVariantNumeric: 'tabular-nums' }}>
                {opts?.showDate ? `${dateStr} · ${timeStr}` : timeStr}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text2, #cbd5e1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.customer_name || t('(no name)')}
              </span>
              {!isExpanded && a.customer_phone && <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, direction: 'ltr', unicodeBidi: 'embed' }}>{a.customer_phone}</span>}
            </div>
            {!isExpanded && (svcName || deptName || a.wilaya || a.notes) && (
              <div style={{ fontSize: 9, color: 'var(--text3, #94a3b8)', marginTop: 1, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {svcName && <span>{svcName}</span>}
                {deptName && <span>· {deptName}</span>}
                {a.wilaya && <span>· <span dir="auto" style={{ unicodeBidi: 'isolate' }}>📍 {normalizeWilayaDisplay(a.wilaya)}</span></span>}
                {a.notes && <span style={{ fontStyle: 'italic' }}>· <span dir="auto" style={{ unicodeBidi: 'isolate' }}>{a.notes}</span></span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 3 }} onClick={e => e.stopPropagation()}>
            <button
              disabled={busy}
              onClick={() => moderateAppointment(a.id, 'approve')}
              title={t('Approve')}
              style={{
                padding: '4px 8px', borderRadius: 5, border: '1px solid #22c55e60',
                background: '#22c55e22', color: '#22c55e', cursor: busy ? 'wait' : 'pointer',
                fontSize: 12, fontWeight: 800,
              }}
            >✓</button>
            <button
              disabled={busy}
              onClick={() => {
                if (!window.confirm(t('Decline this appointment? The customer will be notified.'))) return;
                moderateAppointment(a.id, 'decline');
              }}
              title={t('Decline')}
              style={{
                padding: '4px 8px', borderRadius: 5, border: '1px solid #ef444460',
                background: '#ef444422', color: '#ef4444', cursor: busy ? 'wait' : 'pointer',
                fontSize: 12, fontWeight: 800,
              }}
            >✕</button>
          </div>
        </div>
        {isExpanded && (
          <div style={{
            marginTop: 6, paddingTop: 6,
            borderTop: '1px solid rgba(245,158,11,0.2)',
            display: 'flex', flexDirection: 'column', gap: 4,
            fontSize: 11, color: 'var(--text2, #cbd5e1)',
          }}>
            {a.customer_name && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Name')}</span>
                <span dir="auto" style={{ fontWeight: 600, unicodeBidi: 'isolate' }}>{a.customer_name}</span>
              </div>
            )}
            {a.customer_phone && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Phone')}</span>
                <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{a.customer_phone}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Date')}</span>
              <span>{fullDateStr}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Time')}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
            </div>
            {svcName && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Service')}</span>
                <span>{svcName}</span>
              </div>
            )}
            {deptName && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Department')}</span>
                <span>{deptName}</span>
              </div>
            )}
            {a.wilaya && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Wilaya')}</span>
                <span dir="auto" style={{ unicodeBidi: 'isolate' }}>📍 {normalizeWilayaDisplay(a.wilaya)}</span>
              </div>
            )}
            {a.notes && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Notes')}</span>
                <span dir="auto" style={{ fontStyle: 'italic', unicodeBidi: 'isolate', wordBreak: 'break-word' }}>{a.notes}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }, [officeTimezone, locale, names.services, names.departments, rdvBusyId, expandedPendingId, moderateAppointment, t]);

  // Moderate a pending ticket via the web API (approve or decline)
  const moderatePendingTicket = useCallback(async (ticketId: string, action: 'approve' | 'decline', reason?: string) => {
    setPendingBusyId(ticketId);
    try {
      const res = await cloudFetch('https://qflo.net/api/moderate-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, action, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json().catch(() => ({} as any));
      setPendingTickets((prev) => prev.filter((p) => p.id !== ticketId));
      // Customer reachable via WhatsApp/Messenger? Show "customer notified",
      // otherwise tell the operator the customer wasn't auto-reached.
      const notified = result?.notified === true;
      const baseKey = action === 'approve'
        ? (notified ? 'Appointment approved — customer notified' : 'Appointment approved — customer not reachable on chat')
        : (notified ? 'Appointment declined — customer notified' : 'Appointment declined — customer not reachable on chat');
      showToast(
        translate(locale, baseKey),
        action === 'approve' ? 'success' : 'info',
      );
      // Refresh local queue so approved tickets appear immediately
      if (action === 'approve') fetchTickets();
    } catch (e: any) {
      showToast(e?.message || translate(locale, 'Moderation failed'), 'error');
    } finally {
      setPendingBusyId(null);
    }
  }, [locale, fetchTickets]);

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
      const remaining = Math.max(0, callTimeoutSeconds - elapsed);
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
    if (activeTicket?.status === 'serving' || activeTicket?.status === 'called') {
      // Unified notes: prefer tickets.notes, fall back to customer_data.reason for old tickets
      const notes = (activeTicket as any).notes
        ?? (activeTicket.customer_data as any)?.reason
        ?? (activeTicket.customer_data as any)?.reason_of_visit
        ?? '';
      setTicketNotes(notes);
      // Always show notes field during serving, or when there are existing notes
      setShowNotesField(activeTicket?.status === 'serving' || !!notes);
    } else {
      setTicketNotes('');
      setShowNotesField(false);
    }
  }, [activeTicket?.id, activeTicket?.status]);

  // ── Auto-save notes after 1.5s of inactivity (via direct API) ──
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTicketIdRef = useRef<string | null>(null);
  useEffect(() => { activeTicketIdRef.current = activeTicket?.id ?? null; }, [activeTicket?.id]);
  useEffect(() => {
    const tid = activeTicketIdRef.current;
    if (!tid) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      window.qf.db.saveNotes(tid, ticketNotes.trim());
    }, 1500);
    return () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); };
  }, [ticketNotes]);

  // ── Actions ─────────────────────────────────────────────────────

  // ALWAYS write to SQLite first — sync engine pushes to cloud
  const callingNextRef = useRef(false);
  const callNext = async () => {
    // Double-click guard: prevent concurrent callNext invocations
    if (callingNextRef.current) return;
    callingNextRef.current = true;
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
    } finally {
      // Small delay to prevent rapid double-clicks even after completion
      setTimeout(() => { callingNextRef.current = false; }, 500);
    }
  };

  const startServing = (id: string) => {
    updateTicketStatus(id, { status: 'serving', serving_started_at: new Date().toISOString() });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Serving'), ticket.id);
  };

  const complete = (id: string) => {
    setActiveTicket(null); // Clear panel immediately
    // Flush any unsaved notes before completing
    const notesUpdate = ticketNotes.trim() ? { notes: ticketNotes.trim() } : {};
    updateTicketStatus(id, { status: 'served', completed_at: new Date().toISOString(), ...notesUpdate });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Completed'), ticket.id);
    showToast(t('{ticket} completed', { ticket: ticket?.ticket_number ?? translate(locale, 'Ticket') }), 'success');
  };

  const noShow = async (id: string) => {
    if (!await styledConfirm(t('Mark this ticket as no-show?'), { variant: 'danger', confirmLabel: t('No Show') })) return;
    setActiveTicket(null); // Clear panel immediately
    const notesUpdate = ticketNotes.trim() ? { notes: ticketNotes.trim() } : {};
    updateTicketStatus(id, { status: 'no_show', completed_at: new Date().toISOString(), ...notesUpdate });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'No Show'), ticket.id);
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
      if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Banned'), ticket.id);
    }
  };

  const recall = async (id: string) => {
    const t = tickets.find((t) => t.id === id);
    await updateTicketStatus(id, {
      called_at: new Date().toISOString(),
      recall_count: (t?.recall_count ?? 0) + 1,
    });
    if (t) addActivity(t.ticket_number, translate(locale, 'Recalled'), t.id);
  };

  const requeue = (id: string) => {
    setActiveTicket(null); // Clear calling panel immediately
    updateTicketStatus(id, {
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: null,
    });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, translate(locale, 'Requeued'), t.id);
  };

  const takeOver = (id: string) => {
    updateTicketStatus(id, {
      desk_id: session.desk_id,
      called_by_staff_id: session.staff_id,
    });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Taken over'), ticket.id);
  };

  const park = (id: string) => {
    setActiveTicket(null); // Clear calling panel immediately
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
      addActivity(ticket.ticket_number, translate(locale, 'Ticket parked'), ticket.id);
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
      addActivity(ticket.ticket_number, translate(locale, 'Ticket called back to desk'), ticket.id);
      showToast(t('Ticket called back to desk'), 'success');
    }
  };

  const unparkToQueue = (id: string) => {
    // Don't send status:'waiting' — ticket is already waiting (parked is just a flag).
    // Sending waiting→waiting would fail the transition validator.
    updateTicketStatus(id, {
      parked_at: null,
    });
    const ticket = tickets.find((tk) => tk.id === id);
    if (ticket) {
      addActivity(ticket.ticket_number, translate(locale, 'Ticket sent back to queue'), ticket.id);
      showToast(t('Ticket sent back to queue'), 'info');
    }
  };

  const cancel = async (id: string) => {
    if (!await styledConfirm(t('Cancel this ticket?'), { variant: 'danger', confirmLabel: t('Cancel Ticket') })) return;
    setActiveTicket(null); // Clear panel immediately
    const ts = new Date().toISOString();
    const notesUpdate = ticketNotes.trim() ? { notes: ticketNotes.trim() } : {};
    updateTicketStatus(id, { status: 'cancelled', completed_at: ts, ...notesUpdate });
    const tk = tickets.find((x) => x.id === id);
    if (tk) addActivity(tk.ticket_number, translate(locale, 'Cancelled'), tk.id);
  };

  const bookInHouse = async (data: { department_id: string; service_id?: string; customer_data: { name?: string; phone?: string; reason?: string; wilaya?: string }; priority: number; source: string; appointment_id?: string }) => {
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
        appointment_id: data.appointment_id ?? null,
        created_at: new Date().toISOString(),
      });
      console.log('[station] createTicket result:', JSON.stringify(result));
      fetchTickets();
      const customerLabel = data.customer_data.name || translate(locale, 'Walk-in');
      showToast(translate(locale, 'Ticket created: {ticket} for {name}', { ticket: result.ticket_number, name: customerLabel }), 'success');
      addActivity(result.ticket_number, translate(locale, 'In-house booking'), result.id);
      return result; // return to modal for confirmation screen
    } catch (err: any) {
      showToast(translate(locale, 'Failed to create ticket'), 'error');
      console.error('[station] bookInHouse error:', err);
      return null;
    }
  };

  // ── Appointment check-in helper (thin wrapper for backward compat with modals) ──
  // ── Broadcast functions ────────────────────────────────────────
  const CLOUD_URL = 'https://qflo.net';

  const fetchBroadcastTemplates = useCallback(async () => {
    try {
      const data = await window.qf.templates.list();
      setBroadcastTemplates(data ?? []);
    } catch (err) {
      console.error('[broadcast] Failed to fetch templates:', err);
    }
  }, []);

  const saveBroadcastTemplate = useCallback(async (title: string, bodyFr: string, bodyAr: string, shortcut?: string) => {
    try {
      if (!window.qf?.templates?.save) {
        console.error('[broadcast] templates.save IPC not available');
        showToast(t('Error saving template') + ' (restart required)', 'error');
        return;
      }
      await window.qf.templates.save(title, bodyFr || '', bodyAr || '', shortcut || '');
      console.log('[broadcast] Template saved OK');
      await fetchBroadcastTemplates();
      showToast(t('Template saved'), 'success');
    } catch (err: any) {
      console.error('[broadcast] Failed to save template:', err?.message ?? err, err);
      showToast(t('Error saving template'), 'error');
    }
  }, [fetchBroadcastTemplates]);

  const deleteBroadcastTemplate = useCallback(async (id: string) => {
    if (!await styledConfirm(translate(locale, 'Delete this template?'), { variant: 'danger', confirmLabel: translate(locale, 'Delete') })) return;
    try {
      await window.qf.templates.delete(id);
      setBroadcastTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error('[broadcast] Failed to delete template:', err);
    }
  }, [locale]);

  const sendBroadcast = useCallback(async (msg: { fr: string; ar: string }, templateId?: string) => {
    setBroadcastSending(true);
    setBroadcastResult(null);
    try {
      const messageBody = msg[broadcastLang] || msg.fr || msg.ar;
      console.log('[broadcast] Sending to', CLOUD_URL, 'org:', session.organization_id);
      const accessToken = await ensureAuth();
      console.log('[broadcast] Token present:', !!accessToken, 'len:', accessToken.length);
      const res = await cloudFetch(`${CLOUD_URL}/api/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
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
  const [bookingWidth, setBookingWidth] = useState(420);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  const startSidebarResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
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

  // Booking panel width persistence
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(BOOKING_WIDTH_KEY);
      if (!stored) return;
      const parsed = Number(stored);
      if (!Number.isFinite(parsed)) return;
      setBookingWidth(Math.min(MAX_BOOKING_WIDTH, Math.max(MIN_BOOKING_WIDTH, parsed)));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(BOOKING_WIDTH_KEY, String(bookingWidth)); } catch { /* ignore */ }
  }, [bookingWidth]);

  const startBookingResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = bookingWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      setBookingWidth(Math.min(MAX_BOOKING_WIDTH, Math.max(MIN_BOOKING_WIDTH, startWidth + delta)));
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
  }, [bookingWidth]);

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
  const [recentActivity, setRecentActivity] = useState<Array<{ id?: string | null; ticket: string; action: string; time: string }>>([]);
  // Inline expansion of a recent-activity row — holds the ticket id of the
  // row the operator is currently "drilling into" (null = all collapsed).
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [expandedTicketData, setExpandedTicketData] = useState<{ events: any[]; ticket: any } | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  // Fetch timeline + ticket whenever the expanded row changes.
  useEffect(() => {
    if (!expandedTicketId) { setExpandedTicketData(null); return; }
    let cancelled = false;
    setExpandedLoading(true);
    (window as any).qf?.ticketTimeline?.get(expandedTicketId).then((res: any) => {
      if (cancelled) return;
      let ticket = res?.ticket ?? null;
      if (ticket && typeof ticket.customer_data === 'string') {
        try { ticket.customer_data = JSON.parse(ticket.customer_data); } catch { ticket.customer_data = {}; }
      }
      setExpandedTicketData({ events: res?.events ?? [], ticket });
      setExpandedLoading(false);
    }).catch(() => {
      if (!cancelled) { setExpandedTicketData({ events: [], ticket: null }); setExpandedLoading(false); }
    });
    return () => { cancelled = true; };
  }, [expandedTicketId]);

  // Load recent activity from audit log on mount (persisted across restarts)
  useEffect(() => {
    if (!session?.office_id) return;
    (window as any).qf?.activity?.getRecent(session.office_id, 20).then((rows: any[]) => {
      if (rows?.length) {
        setRecentActivity(rows.map((r: any) => ({
          id: r.id ?? null,
          ticket: r.ticket,
          action: translateAction(r.action),
          time: formatDesktopTime(r.time, locale),
        })));
      }
    }).catch(() => {});
  }, [locale, session?.office_id, translateAction]);

  // Track completed actions — only keep the latest status per ticket.
  // `id` is the ticket id; pass it so the row can be clicked to expand
  // ticket details. Call sites without an id at hand fall back to a
  // lookup by ticket_number in local state at click time.
  const addActivity = useCallback((ticket: string, action: string, id?: string | null) => {
    setRecentActivity((prev) => {
      const filtered = prev.filter((a) => a.ticket !== ticket);
      // Keep up to 20 entries in memory so a busy shift doesn't churn the
      // list. The idle-panel renderer already caps what it displays via
      // .slice(0, 15), so extra headroom here is free.
      return [
        { id: id ?? null, ticket, action, time: formatDesktopTime(new Date(), locale) },
        ...filtered.slice(0, 19),
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
  const [showDevices, setShowDevices] = useState(false);
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

  // Helper for RDV tab — minutes until scheduled time
  const minutesUntil = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return (
    <div className="station" role="main">
      {dbRecovery && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: dbRecovery.action === 'fresh' ? '#b45309' : '#1d4ed8',
            color: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center',
            gap: 12, fontSize: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          <span style={{ flex: 1 }}>
            {dbRecovery.action === 'restored'
              ? t('Local database was repaired from a backup. Please verify today’s tickets.')
              : t('Local database was rebuilt from the cloud. Please sign in again and verify today’s tickets.')}
          </span>
          <button
            onClick={async () => {
              if (!confirm(t('Rebuild the local database from the cloud? This will sign you out.'))) return;
              try { await window.qf?.db?.rebuildFromCloud?.(); } catch { /* app will relaunch */ }
            }}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}
          >
            {t('Rebuild from cloud')}
          </button>
          <button
            onClick={() => { sessionStorage.setItem('qflo_db_recovery_dismissed', '1'); setDbRecovery(null); }}
            aria-label={t('Dismiss')}
            style={{ background: 'transparent', color: '#fff', border: 'none', fontSize: 18, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}
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
      {/* Left panel — active ticket / calendar */}
      <div className="station-main" aria-label={t('Active tickets')} style={
        mainView !== 'queue' && session.desk_id
          ? { padding: 0, justifyContent: 'flex-start', alignItems: 'stretch' }
          : showBookingModal && mainView === 'queue'
            ? { paddingRight: 0 }
            : undefined
      }>
        {/* Timeline strip removed — Queue/Calendar tab toggle is sufficient */}
        {!session.desk_id ? (
          <div className="no-desk" role="alert">
            <h2>{t('No Desk Assigned')}</h2>
            <p>{t('Ask your admin to assign you to a desk before you can start serving.')}</p>
          </div>
        ) : (
          <>
          {/* Unified toolbar — always visible: pills-left (pause/status, idle only) + pills-right (tab capsule, always) */}
          <div className="station-action-pills">
            <div className="pills-left">
              {/* Pause toggle + status — only when idle (no active ticket) */}
              {!activeTicket && staffStatus === 'available' && (
                <button
                  onClick={() => {
                    onQueuePausedChange(!queuePaused);
                    showToast(queuePaused ? t('Queue resumed') : t('Queue paused - no new calls'), queuePaused ? 'success' : 'info');
                  }}
                  title="F7 — Toggle pause"
                  className="pause-toggle"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '5px 12px 5px 6px',
                    borderRadius: 20,
                    border: queuePaused ? '1.5px solid rgba(249,115,22,0.4)' : '1.5px solid var(--border)',
                    background: queuePaused ? 'rgba(249,115,22,0.15)' : 'transparent',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    color: queuePaused ? '#f97316' : 'var(--text2)',
                    transition: 'all 0.2s ease',
                  }}
                  aria-label={queuePaused ? t('Resume') : t('Pause')}
                >
                  <span style={{
                    position: 'relative',
                    width: 40, height: 22, borderRadius: 11,
                    background: queuePaused ? '#f97316' : 'var(--surface2)',
                    display: 'inline-block',
                    transition: 'background 0.2s ease',
                    flexShrink: 0,
                  }}>
                    <span style={{
                      position: 'absolute',
                      top: 2, left: queuePaused ? 20 : 2,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.2s ease',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }}>
                      {queuePaused ? '⏸' : ''}
                    </span>
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {queuePaused ? t('Paused') : t('Pause')}
                  </span>
                  {queuePaused && pauseElapsed > 0 && (
                    <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8, fontSize: 11 }}>
                      {`${Math.floor(pauseElapsed / 60)}:${String(pauseElapsed % 60).padStart(2, '0')}`}
                    </span>
                  )}
                  <span className="shortcut-hint" style={{ color: 'inherit', opacity: 0.5, background: 'rgba(0,0,0,0.15)' }}>F7</span>
                </button>
              )}

              {/* Staff status — only when idle and not available */}
              {!activeTicket && staffStatus !== 'available' && (
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
                      position: 'absolute', top: '100%', left: 0,
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
            <div className="pills-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Primary action — standalone pill, visually distinct from the view tabs.
                  Opens the in-house booking side panel (walk-in + future in one form). */}
              <button
                onClick={() => setShowBookingModal(prev => !prev)}
                title="F6"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', borderRadius: 20,
                  border: `1.5px solid ${showBookingModal ? '#8b5cf6' : 'rgba(139,92,246,0.5)'}`,
                  background: showBookingModal ? '#8b5cf6' : 'rgba(139,92,246,0.12)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  color: showBookingModal ? '#fff' : '#a78bfa',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                + {t('New Ticket')} <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>F6</span>
              </button>

              {/* View-switcher capsule: Queue / Calendar / Customers */}
              <div style={{
                display: 'flex', gap: 0, border: '1.5px solid var(--border, #334155)', borderRadius: 20, overflow: 'hidden',
              }}>
                <button
                  onClick={() => setMainView('queue')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 12px', border: 'none',
                    background: mainView === 'queue'
                      ? (activeTicket?.status === 'serving' ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.2)')
                      : activeTicket
                        ? (activeTicket.status === 'serving' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)')
                        : 'transparent',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    color: mainView === 'queue'
                      ? (activeTicket?.status === 'serving' ? '#22c55e' : '#3b82f6')
                      : activeTicket
                        ? (activeTicket.status === 'serving' ? '#22c55e' : '#3b82f6')
                        : 'var(--text3, #64748b)',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    animation: activeTicket && mainView !== 'queue'
                      ? (activeTicket.status === 'serving' ? 'queue-pulse-serving 2s ease-in-out infinite' : 'queue-pulse 2s ease-in-out infinite')
                      : 'none',
                    borderRadius: activeTicket && mainView !== 'queue' ? 6 : 0,
                  }}
                >
                  📋 {t('Queue')}
                  {activeTicket && mainView !== 'queue' && (
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: activeTicket.status === 'serving' ? '#22c55e' : '#3b82f6',
                      animation: activeTicket.status === 'serving' ? 'queue-pulse-serving 2s ease-in-out infinite' : 'queue-pulse 2s ease-in-out infinite',
                      flexShrink: 0,
                    }} />
                  )}
                </button>
                <button
                  onClick={() => { setMainView('calendar'); setCalendarInitialView('week'); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 12px', border: 'none', borderLeft: '1px solid var(--border, #334155)',
                    background: mainView === 'calendar' ? 'rgba(99,102,241,0.2)' : 'transparent',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    color: mainView === 'calendar' ? '#818cf8' : 'var(--text3, #64748b)',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  📅 {t('Calendar')}
                </button>
                <button
                  onClick={() => setMainView('customers')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 12px', border: 'none', borderLeft: '1px solid var(--border, #334155)',
                    background: mainView === 'customers' ? 'rgba(59,130,246,0.2)' : 'transparent',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    color: mainView === 'customers' ? '#3b82f6' : 'var(--text3, #64748b)',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  {/* Inline SVG instead of 👥 emoji so the icon can be colored
                      (Windows renders the emoji as dim purple, invisible in dark mode). */}
                  <svg
                    className="client-icon"
                    width="14" height="14" viewBox="0 0 24 24"
                    fill="none" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  {t('Customers')}
                </button>
              </div>
            </div>
          </div>

          {/* Embedded Calendar — mount once, keep alive */}
          {mountedTabs.has('calendar') && (
            <div style={{ flex: 1, overflow: 'hidden', width: '100%', marginTop: 42, display: mainView === 'calendar' ? 'flex' : 'none' }}>
              <CalendarModal
                organizationId={session.organization_id}
                officeId={session.office_id}
                locale={locale}
                storedAuth={storedAuth}
                departments={names.departments}
                services={allServices}
                officeTimezone={officeTimezone}
                onClose={() => setMainView('queue')}
                onModerate={moderateAppointment}
                onAppointmentChange={() => fetchTodayRef.current()}
                onOpenCustomer={(phone) => {
                  setCustomerPhoneToOpen(phone);
                  setMainView('customers');
                }}
                onSlotBook={(date, time) => {
                  // Unified intake: open the same InHouseBookingPanel that the queue
                  // screen uses, prefilled with the selected slot. Fields come from
                  // the admin's intake_fields config. The panel is a right-side
                  // overlay so the operator stays on the calendar view.
                  setBookingPrefill({ futureDate: date, futureTime: time, _ts: Date.now() });
                  setShowBookingModal(true);
                }}
                initialViewMode={calendarInitialView}
                initialAppointmentId={calendarInitialApptId}
                embedded
                refreshKey={calendarRefreshKey}
              />
            </div>
          )}

          {/* Embedded Customers — mount once, keep alive */}
          {mountedTabs.has('customers') && (
            <div style={{ flex: 1, overflow: 'hidden', width: '100%', marginTop: 42, display: mainView === 'customers' ? 'flex' : 'none' }}>
              <CustomersModal
                organizationId={session.organization_id}
                locale={locale}
                storedAuth={storedAuth}
                timezone={officeTimezone}
                onClose={() => setMainView('queue')}
                onBookCustomer={(c) => {
                  setBookingPrefill({ ...c, _ts: Date.now() });
                  setMainView('queue');
                  setShowBookingModal(true);
                }}
                initialPhone={customerPhoneToOpen}
                embedded
                refreshKey={customersRefreshKey}
              />
            </div>
          )}

          {activeTicket && (
          <div className="active-ticket-panel" style={{ display: mainView === 'queue' ? undefined : 'none' }}>
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
                {getTicketCustomerPhone(activeTicket.customer_data) ? (
                  <div
                    className="active-customer"
                    onClick={() => {
                      const phone = getTicketCustomerPhone(activeTicket.customer_data);
                      if (phone) { setCustomerPhoneToOpen(phone); setShowCustomersModal(true); }
                    }}
                    style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 4 }}
                    title={t('View customer profile')}
                  >
                    {getTicketCustomerName(activeTicket.customer_data) ?? t('Walk-in Customer')}
                  </div>
                ) : (
                  <div className="active-customer">
                    {getTicketCustomerName(activeTicket.customer_data) ?? t('Walk-in Customer')}
                  </div>
                )}
                {getTicketCustomerPhone(activeTicket.customer_data) && (
                  <div
                    className="active-phone"
                    onClick={() => {
                      const phone = getTicketCustomerPhone(activeTicket.customer_data);
                      if (phone) { setCustomerPhoneToOpen(phone); setShowCustomersModal(true); }
                    }}
                    style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
                    title={t('View customer profile')}
                  >
                    {getTicketCustomerPhone(activeTicket.customer_data)}
                  </div>
                )}
                {(activeTicket.customer_data as any)?.wilaya && (
                  <div className="active-notes">
                    <strong>{t('Wilaya:')}</strong> {normalizeWilayaDisplay((activeTicket.customer_data as any).wilaya)}
                  </div>
                )}
                {getCustomIntakeFields(activeTicket.customer_data).map(([key, value]) => (
                  <div key={key} className="active-notes" style={{ fontSize: 13, color: 'var(--text2)' }}>
                    <strong>{key}:</strong> {value}
                  </div>
                ))}
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? t('Service')} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? t('Dept')}
                </div>

                {/* Notes (editable during called state) */}
                <div style={{ width: '100%', maxWidth: 500, margin: '8px auto' }}>
                  {!showNotesField ? (
                    <button
                      onClick={() => setShowNotesField(true)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                        border: '1px solid var(--border)', borderRadius: 8, background: 'transparent',
                        color: 'var(--text2)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      + {t('Notes')}
                    </button>
                  ) : (
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 4 }}>
                        {t('Notes')}
                      </label>
                      <textarea
                        value={ticketNotes}
                        onChange={(e) => setTicketNotes(e.target.value)}
                        onBlur={() => {
                          if (activeTicket) window.qf.db.saveNotes(activeTicket.id, ticketNotes.trim());
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder={t('Reason of visit / notes...')}
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
                </div>

                {/* Countdown */}
                <div className="countdown-ring" role="timer" aria-label={t('{seconds} seconds remaining', { seconds: callCountdown })}>
                  <svg viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#1e293b" strokeWidth="6" />
                    <circle
                      cx="50" cy="50" r="45" fill="none"
                      stroke={callCountdown > 15 ? '#3b82f6' : callCountdown > 5 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="6"
                      strokeDasharray={`${(callCountdown / callTimeoutSeconds) * 283} 283`}
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
                {getTicketCustomerPhone(activeTicket.customer_data) ? (
                  <div
                    className="active-customer"
                    onClick={() => {
                      const phone = getTicketCustomerPhone(activeTicket.customer_data);
                      if (phone) { setCustomerPhoneToOpen(phone); setShowCustomersModal(true); }
                    }}
                    style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 4 }}
                    title={t('View customer profile')}
                  >
                    {getTicketCustomerName(activeTicket.customer_data) ?? t('Walk-in Customer')}
                  </div>
                ) : (
                  <div className="active-customer">
                    {getTicketCustomerName(activeTicket.customer_data) ?? t('Walk-in Customer')}
                  </div>
                )}
                {getTicketCustomerPhone(activeTicket.customer_data) && (
                  <div
                    className="active-phone"
                    onClick={() => {
                      const phone = getTicketCustomerPhone(activeTicket.customer_data);
                      if (phone) { setCustomerPhoneToOpen(phone); setShowCustomersModal(true); }
                    }}
                    style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
                    title={t('View customer profile')}
                  >
                    {getTicketCustomerPhone(activeTicket.customer_data)}
                  </div>
                )}
                {(activeTicket.customer_data as any)?.wilaya && (
                  <div className="active-notes">
                    <strong>{t('Wilaya:')}</strong> {normalizeWilayaDisplay((activeTicket.customer_data as any).wilaya)}
                  </div>
                )}
                {getCustomIntakeFields(activeTicket.customer_data).map(([key, value]) => (
                  <div key={key} className="active-notes" style={{ fontSize: 13, color: 'var(--text2)' }}>
                    <strong>{key}:</strong> {value}
                  </div>
                ))}
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
                      + {t('Notes')}
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
                          if (activeTicket) window.qf.db.saveNotes(activeTicket.id, ticketNotes.trim());
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder={t('Reason of visit / notes...')}
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
                          <div><strong>{t('Last:')}</strong> {new Date(customerHistory.customer.last_visit_at).toLocaleDateString('fr-FR')}</div>
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
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4, textTransform: locale === 'ar' ? 'none' as const : 'uppercase' as const, letterSpacing: locale === 'ar' ? 'normal' : 0.5 }}>
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
                              {new Date(rt.created_at).toLocaleDateString('fr-FR')} &middot;{' '}
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
          )}

          {/* Queue view: idle panel + optional booking side panel (only when no active ticket) */}
          {!activeTicket && (
          <div style={{
            display: mainView === 'queue' ? 'flex' : 'none',
            flex: 1, width: '100%', alignItems: 'stretch', overflow: 'hidden',
          }}>
            {/* Idle panel — left side (or full width when booking closed) */}
            <div className="idle-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
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

                  {/* Recent Activity — always-visible canvas card with clickable tickets.
                      Clicking a ticket sets the waiting-list search filter so the
                      operator can quickly locate it in the side panel. */}
                  {recentActivity.length > 0 && (
                    <div style={{
                      marginTop: 32, width: '100%', maxWidth: 520,
                      background: 'var(--surface, #1e293b)',
                      border: '1px solid var(--border, #334155)',
                      borderRadius: 12, padding: '16px 18px',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <h4 style={{
                          fontSize: 13, fontWeight: 800, color: 'var(--text2, #94a3b8)',
                          letterSpacing: locale === 'ar' ? 'normal' : 1.2,
                          textTransform: locale === 'ar' ? 'none' as const : 'uppercase' as const,
                          margin: 0,
                        }}>
                          {t('Recent Activity ({count})', { count: recentActivity.length })}
                        </h4>
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                          {t('Click a ticket to find it')}
                        </span>
                      </div>
                      <div
                        role="list"
                        aria-label={t('Recent activity')}
                        style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}
                      >
                        {recentActivity.slice(0, 15).map((a, i) => {
                          const isCompleted = a.action === t('Completed');
                          const isNoShow = a.action === t('No Show');
                          const isCancelled = a.action === t('Cancelled') || a.action === t('cancelled');
                          const badgeBg = isCompleted ? 'rgba(34,197,94,0.15)'
                            : isNoShow ? 'rgba(249,115,22,0.15)'
                            : isCancelled ? 'rgba(239,68,68,0.15)'
                            : 'rgba(59,130,246,0.15)';
                          const badgeColor = isCompleted ? '#22c55e'
                            : isNoShow ? '#f97316'
                            : isCancelled ? '#ef4444'
                            : '#3b82f6';
                          const rowId = a.id || tickets.find(tk => tk.ticket_number === a.ticket)?.id || null;
                          const isExpanded = rowId !== null && expandedTicketId === rowId;
                          return (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                              <button
                                role="listitem"
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() => {
                                  if (!rowId) {
                                    // Fallback when no id — filter the waiting list.
                                    const stillWaiting = waiting.some(tk => tk.ticket_number === a.ticket);
                                    if (stillWaiting) {
                                      setSearchFilter(a.ticket);
                                      setShowAllWaiting(false);
                                    }
                                    showToast(`${a.ticket} — ${a.action}`, 'info');
                                    return;
                                  }
                                  setExpandedTicketId((cur) => (cur === rowId ? null : rowId));
                                }}
                                title={t('Show ticket details')}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  gap: 12, padding: '12px 14px',
                                  borderRadius: isExpanded ? '10px 10px 0 0' : 10,
                                  background: isExpanded ? 'rgba(59,130,246,0.10)' : 'transparent',
                                  border: '1px solid ' + (isExpanded ? 'rgba(59,130,246,0.35)' : 'transparent'),
                                  borderBottom: isExpanded ? '1px solid rgba(59,130,246,0.35)' : undefined,
                                  cursor: 'pointer', textAlign: 'inherit',
                                  color: 'var(--text, #e2e8f0)',
                                  transition: 'background 0.15s, border-color 0.15s',
                                }}
                                onMouseEnter={(e) => {
                                  if (!isExpanded) {
                                    e.currentTarget.style.background = 'rgba(59,130,246,0.08)';
                                    e.currentTarget.style.borderColor = 'rgba(59,130,246,0.25)';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!isExpanded) {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.borderColor = 'transparent';
                                  }
                                }}
                              >
                                <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                                  <span style={{
                                    display: 'inline-block', width: 12, color: '#60a5fa',
                                    fontSize: 12, transform: isExpanded ? 'rotate(90deg)' : 'none',
                                    transition: 'transform 0.15s',
                                  }}>▶</span>
                                  <strong style={{
                                    fontSize: 15, fontVariantNumeric: 'tabular-nums',
                                    color: '#60a5fa', minWidth: 70,
                                  }}>{a.ticket}</strong>
                                  <span style={{ fontSize: 13, color: 'var(--text3, #94a3b8)' }}>· {a.time}</span>
                                </span>
                                <span style={{
                                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12,
                                  whiteSpace: 'nowrap',
                                  background: badgeBg, color: badgeColor,
                                }}>
                                  {a.action}
                                </span>
                              </button>
                              {isExpanded && (
                                <InlineTicketDetails
                                  loading={expandedLoading}
                                  data={expandedTicketData}
                                  locale={locale as 'en' | 'fr' | 'ar'}
                                  t={t}
                                  onFindInWaiting={(num) => {
                                    const stillWaiting = waiting.some(tk => tk.ticket_number === num);
                                    if (stillWaiting) {
                                      setSearchFilter(num);
                                      setShowAllWaiting(false);
                                      setExpandedTicketId(null);
                                    }
                                  }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

          </div>
          )}
          </>
        )}

        {/* In-House Booking — right side overlay, works across queue / calendar / customers views */}
        {showBookingModal && session.desk_id && (
          <div style={{
            position: 'absolute', top: 42, right: 0, bottom: 0,
            width: bookingWidth,
            borderLeft: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            zIndex: 20,
            boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
          }}>
            <button
              type="button"
              className="station-sidebar-resizer"
              onPointerDown={startBookingResize}
            />
            <InHouseBookingPanel
              locale={locale}
              departments={Object.entries(names.departments)}
              services={allServices}
              officeId={session.office_id}
              onBook={bookInHouse}
              onCollapse={() => { setShowBookingModal(false); setBookingPrefill(null); }}
              messengerPageId={messengerPageId}
              whatsappPhone="+213551176598"
              session={session}
              prefill={bookingPrefill}
              storedAuth={storedAuth}
              timezone={officeTimezone}
              orgSettings={orgSettings}
            />
          </div>
        )}

        {/* Calendar Modal (full-screen overlay — opens via F5 or external triggers) */}
        {showCalendarModal && (
          <CalendarModal
            key={`modal-${calendarInitialView}-${calendarInitialApptId || ''}`}
            organizationId={session.organization_id}
            officeId={session.office_id}
            locale={locale}
            storedAuth={storedAuth}
            departments={names.departments}
            services={allServices}
            officeTimezone={officeTimezone}
            onClose={() => { setShowCalendarModal(false); setCalendarInitialApptId(null); }}
            onModerate={moderateAppointment}
            onAppointmentChange={() => fetchTodayRef.current()}
            onOpenCustomer={(phone) => {
              setCustomerPhoneToOpen(phone);
              setShowCustomersModal(true);
            }}
            onSlotBook={(date, time) => {
              // Unified intake: close calendar overlay and open InHouseBookingPanel
              // prefilled with the slot. Fields come from intake_fields settings.
              setBookingPrefill({ futureDate: date, futureTime: time, _ts: Date.now() });
              setShowCalendarModal(false);
              setCalendarInitialApptId(null);
              setShowBookingModal(true);
            }}
            initialViewMode={calendarInitialView}
            initialAppointmentId={calendarInitialApptId}
          />
        )}

        {/* Settings Modal */}
        {showSettingsModal && (
          <SettingsModal
            organizationId={session.organization_id}
            officeId={session.office_id}
            locale={locale}
            storedAuth={storedAuth}
            officeName={session.office_name}
            onClose={() => { setShowSettingsModal(false); setSettingsVersion(v => v + 1); }}
            onOpenTeam={() => setShowTeamModal(true)}
            onOpenBusinessAdmin={() => setShowBusinessAdminModal(true)}
          />
        )}

        {/* Team Modal */}
        {showTeamModal && (
          <TeamModal
            organizationId={session.organization_id}
            callerUserId={session.user_id}
            callerRole={session.role}
            locale={locale}
            onClose={() => setShowTeamModal(false)}
          />
        )}

        {/* Business Administration Modal */}
        {showBusinessAdminModal && (
          <BusinessAdminModal
            organizationId={session.organization_id}
            callerUserId={session.user_id}
            callerRole={session.role}
            locale={locale}
            onClose={() => setShowBusinessAdminModal(false)}
          />
        )}

        {/* Customers Modal */}
        {showCustomersModal && (
          <CustomersModal
            organizationId={session.organization_id}
            locale={locale}
            storedAuth={storedAuth}
            timezone={officeTimezone}
            onClose={() => { setShowCustomersModal(false); setCustomerPhoneToOpen(undefined); }}
            onBookCustomer={(c) => {
              setBookingPrefill({ ...c, _ts: Date.now() });
              setShowCustomersModal(false);
              setCustomerPhoneToOpen(undefined);
              setShowBookingModal(true);
            }}
            initialPhone={customerPhoneToOpen}
          />
        )}

        {/* In-House Booking Panel moved to split view inside queue tab */}
      </div>

      {/* Expand button when sidebar is collapsed — sits flush against right edge */}
      {!isSmallScreen && sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          title={t('Show queue panel')}
          aria-label={t('Show queue panel')}
          style={{
            flexShrink: 0, width: 18, alignSelf: 'center',
            height: 48, borderRadius: '6px 0 0 6px',
            border: '1px solid var(--border, rgba(255,255,255,0.15))', borderRight: 'none',
            background: 'var(--surface2, var(--surface, rgba(255,255,255,0.08)))', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text, #e2e8f0)', fontSize: 10,
          }}
        >
          ◀
        </button>
      )}

      {/* Right panel — queue overview */}
      <div
        className={`station-sidebar${isSmallScreen && sidebarVisible ? ' sidebar-visible' : ''}`}
        role="complementary"
        aria-label={t('Queue Overview')}
        style={isSmallScreen ? undefined : { width: sidebarCollapsed ? 0 : sidebarWidth, minWidth: sidebarCollapsed ? 0 : undefined, overflow: sidebarCollapsed ? 'hidden' : undefined, borderLeft: sidebarCollapsed ? 'none' : undefined }}
      >
        {/* Resize handle + toggle — overlaid on the left edge, zero layout width */}
        {!isSmallScreen && !sidebarCollapsed && (
          <div
            onPointerDown={startSidebarResize}
            style={{ position: 'absolute', top: 0, left: -3, width: 6, height: '100%', zIndex: 10, cursor: 'col-resize' }}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSidebarCollapsed(true); }}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('Hide queue panel')}
              aria-label={t('Hide queue panel')}
              style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: 12, height: 48, borderRadius: 6,
                border: '1px solid var(--border, rgba(255,255,255,0.15))',
                background: 'var(--surface2, var(--surface, rgba(255,255,255,0.08)))', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text, #e2e8f0)', fontSize: 10,
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
              }}
            >
              ▶
            </button>
          </div>
        )}
        <div className="sidebar-section">
          <div className="sidebar-header">
            {/*
              Removed the "Queue Overview" h3 title and the waiting/called/
              serving stat-pills row — both were redundant with the tab
              badges below (which already show counts) and the in-tab
              section headers like WAITING (1) / ACTIVE (0).
              SR users still get the breakdown via the aria-label on the
              tab container.
            */}
            <div
              style={{ display: 'flex', gap: 4, background: 'var(--bg, #0f172a)', padding: 4, borderRadius: 10 }}
              aria-label={t('{waiting} waiting, {called} called, {serving} serving', { waiting: waiting.length, called: called.length, serving: serving.length })}
            >
              <button
                onClick={() => setQueueTab('queue')}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: queueTab === 'queue' ? '#3b82f6' : 'transparent',
                  color: queueTab === 'queue' ? '#fff' : 'var(--text3, #94a3b8)',
                  fontSize: 12, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.2s ease',
                  boxShadow: queueTab === 'queue' ? '0 2px 8px rgba(59,130,246,0.35)' : 'none',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0 }} aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {t('Queue')}
                <span style={{
                  background: queueTab === 'queue' ? 'rgba(0,0,0,0.22)' : 'rgba(148,163,184,0.22)',
                  color: queueTab === 'queue' ? '#fff' : 'var(--text, #e2e8f0)',
                  borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 800,
                  transition: 'all 0.2s ease',
                }}>{waiting.length + called.length + serving.length}</span>
              </button>
              <button
                onClick={() => setQueueTab('rdv')}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: queueTab === 'rdv' ? '#22c55e' : 'transparent',
                  color: queueTab === 'rdv' ? '#fff' : 'var(--text3, #94a3b8)',
                  fontSize: 12, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.2s ease',
                  boxShadow: queueTab === 'rdv' ? '0 2px 8px rgba(34,197,94,0.35)' : 'none',
                }}
              >
                📅 {t('RDV')}
                <span style={{
                  background: queueTab === 'rdv' ? 'rgba(0,0,0,0.22)' : 'rgba(148,163,184,0.22)',
                  color: queueTab === 'rdv' ? '#fff' : 'var(--text, #e2e8f0)',
                  borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 800,
                  transition: 'all 0.2s ease',
                }}>{totalRdvCount}</span>
              </button>
              <button
                onClick={() => setQueueTab('pending')}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: queueTab === 'pending' ? '#f59e0b' : 'transparent',
                  color: queueTab === 'pending' ? '#fff' : 'var(--text3, #94a3b8)',
                  fontSize: 12, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  position: 'relative',
                  transition: 'all 0.2s ease',
                  boxShadow: queueTab === 'pending' ? '0 2px 8px rgba(245,158,11,0.35)' : 'none',
                }}
              >
                ⏳ {t('Approvals')}
                <span style={{
                  background: queueTab === 'pending'
                    ? 'rgba(0,0,0,0.22)'
                    : (pendingTotalCount > 0 ? '#f59e0b' : 'rgba(148,163,184,0.22)'),
                  color: queueTab === 'pending'
                    ? '#fff'
                    : (pendingTotalCount > 0 ? '#fff' : 'var(--text, #e2e8f0)'),
                  borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 800,
                }}>{pendingTotalCount}</span>
              </button>
            </div>
          </div>
        </div>

        {queueTab === 'rdv' && (() => {
          const renderApptCard = (a: typeof confirmedAppointments[0], isToday: boolean) => {
            const mins = minutesUntil(a.scheduled_at);
            const isPast = isToday && mins < -5;
            const isSoon = isToday && mins >= -5 && mins <= 15;
            const timeStr = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: officeTimezone }).format(new Date(a.scheduled_at));
            const color = STATION_RDV_STATUS_COLORS[a.status] || '#64748b';
            const svcName = (a.service_id && names.services?.[a.service_id]) || '';
            const deptName = (a.department_id && names.departments?.[a.department_id]) || '';
            const busy = rdvBusyId === a.id;
            return (
              <div
                key={a.id}
                style={{
                  padding: '4px 8px',
                  background: isSoon ? 'rgba(34,197,94,0.10)' : 'var(--bg, #0f172a)',
                  border: `1px solid ${isSoon ? '#22c55e55' : 'var(--border, #334155)'}`,
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 6,
                  opacity: isPast || busy ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 36, gap: 1 }}>
                    <span style={{
                      padding: '0px 5px', borderRadius: 6, fontSize: 7, fontWeight: 800,
                      textTransform: 'uppercase', letterSpacing: 0.3,
                      background: `${color}22`, color, whiteSpace: 'nowrap', lineHeight: '14px',
                    }}>
                      {t(a.status)}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text, #f1f5f9)', fontVariantNumeric: 'tabular-nums' }}>
                      {timeStr}
                    </span>
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span dir="auto" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2, #cbd5e1)', unicodeBidi: 'isolate' }}>
                      {a.customer_name || t('(no name)')}
                    </span>
                    {a.wilaya && <span dir="auto" style={{ fontSize: 9, color: 'var(--text3, #94a3b8)', unicodeBidi: 'isolate' }}>📍 {normalizeWilayaDisplay(a.wilaya)}</span>}
                  </div>
                  {isToday && mins !== 0 && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: isSoon ? '#22c55e' : 'var(--text3, #94a3b8)', whiteSpace: 'nowrap' }}>
                      {mins > 0 ? t('in {n}m', { n: mins }) : t('{n}m ago', { n: -mins })}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                  {(svcName || deptName || a.notes) && (
                    <div style={{ flex: 1, fontSize: 9, color: 'var(--text3, #94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'ltr', unicodeBidi: 'isolate', minWidth: 0 }}>
                      {[svcName, deptName].filter(Boolean).map((s, i) => <span key={i}>{i > 0 ? ' · ' : ''}{s}</span>)}
                      {a.notes && <span>{(svcName || deptName) ? ' · ' : ''}<span dir="auto" style={{ unicodeBidi: 'isolate' }}>{a.notes}</span></span>}
                    </div>
                  )}
                  {!(svcName || deptName || a.notes) && <div style={{ flex: 1 }} />}
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                    {isToday && (
                      <button
                        disabled={busy}
                        onClick={async () => {
                          await moderateAppointment(a.id, 'check_in');
                          setQueueTab('queue');
                        }}
                        style={{
                          padding: '2px 6px', borderRadius: 4, border: '1px solid #22c55e60',
                          background: '#22c55e22', color: '#22c55e', cursor: busy ? 'wait' : 'pointer',
                          fontSize: 10, fontWeight: 700,
                        }}
                      >
                        → {t('Register')}
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (!await styledConfirm(t('Cancel this appointment? The customer will be notified.'), { variant: 'danger', confirmLabel: t('Cancel Appointment') })) return;
                        await moderateAppointment(a.id, 'cancel');
                      }}
                      title={t('Cancel')}
                      style={{
                        padding: '2px 7px', borderRadius: 4, border: '1px solid #ef444460',
                        background: '#ef444422', color: '#ef4444', cursor: busy ? 'wait' : 'pointer',
                        fontSize: 10, fontWeight: 700,
                      }}
                    >
                      ✕
                    </button>
                    <button
                      onClick={() => { setCalendarInitialApptId(a.id); setCalendarInitialView('week'); setMainView('calendar'); }}
                      style={{
                        padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border, #334155)',
                        background: 'transparent', color: 'var(--text3, #94a3b8)', cursor: 'pointer',
                        fontSize: 10, fontWeight: 600,
                      }}
                    >
                      {t('Details')}
                    </button>
                  </div>
                </div>
              </div>
            );
          };
          return (
            <div className="sidebar-section queue-list" style={{ flex: 1, overflowY: 'auto' }}>
              {/* ── Today ── */}
              <h4 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                {t('Today')} <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3, #94a3b8)' }}>({confirmedAppointments.length})</span>
              </h4>
              {confirmedAppointments.length === 0 ? (
                <div className="queue-empty" style={{ marginBottom: 12 }}>{t('No appointments today')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                  {confirmedAppointments.map((a) => renderApptCard(a, true))}
                </div>
              )}

              {/* ── Upcoming ── */}
              {Object.keys(upcomingByDate).length > 0 && (
                <>
                  <h4 style={{ margin: '0 0 8px', color: 'var(--text2, #cbd5e1)' }}>
                    {t('Upcoming')} <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3, #94a3b8)' }}>({confirmedUpcoming.length})</span>
                  </h4>
                  {Object.entries(upcomingByDate).map(([dateLabel, appts]) => {
                    const isExpanded = expandedDates[dateLabel] !== false; // default expanded
                    return (
                      <div key={dateLabel} style={{ marginBottom: 8 }}>
                        <button
                          onClick={() => setExpandedDates((prev) => ({ ...prev, [dateLabel]: !isExpanded }))}
                          style={{
                            width: '100%', padding: '6px 10px', borderRadius: 6,
                            border: '1px solid var(--border, #334155)',
                            background: 'var(--surface2, #1e293b)',
                            color: 'var(--text, #f1f5f9)',
                            cursor: 'pointer', fontSize: 12, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          }}
                        >
                          <span>📅 {dateLabel}</span>
                          <span style={{ fontSize: 10, color: 'var(--text3, #94a3b8)' }}>
                            {appts.length} {t('RDV')} {isExpanded ? '▾' : '▸'}
                          </span>
                        </button>
                        {isExpanded && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                            {appts.map((a) => renderApptCard(a, false))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {totalRdvCount === 0 && (
                <div className="queue-empty">{t('No appointments')}</div>
              )}
            </div>
          );
        })()}

        {queueTab === 'pending' && (
          <div className="sidebar-section queue-list" style={{ flex: 1, overflowY: 'auto' }}>
            <h4 style={{ margin: '0 0 10px' }}>⏳ {t('Pending approval')} ({pendingTotalCount})</h4>
            {pendingTotalCount === 0 && (
              <div className="queue-empty">{t('No pending items')}</div>
            )}

            {/* ── Section 1: Live tickets (today, real-time) ── */}
            {pendingTickets.length > 0 && (
              <div style={{
                fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
                color: '#f59e0b', marginBottom: 6, paddingBottom: 4,
                borderBottom: '1px solid rgba(245,158,11,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>🎫 {t('Live tickets')}</span>
                <span style={{ background: '#f59e0b', color: '#000', borderRadius: 10, padding: '1px 7px', fontSize: 9 }}>
                  {pendingTickets.length}
                </span>
              </div>
            )}
            {pendingTickets.length === 0 ? null : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pendingTickets.map((p) => {
                  const cd = (() => { try { return typeof p.customer_data === 'string' ? JSON.parse(p.customer_data) : (p.customer_data || {}); } catch { return {}; } })();
                  const svcName = (p.service_id && names.services?.[p.service_id]) || '';
                  const deptName = (p.department_id && names.departments?.[p.department_id]) || '';
                  const busy = pendingBusyId === p.id;
                  const waitedMin = Math.round((Date.now() - new Date(p.created_at).getTime()) / 60000);
                  const sourceLabel = p.source === 'whatsapp' ? 'WhatsApp' : p.source === 'messenger' ? 'Messenger' : p.source === 'kiosk' ? t('Kiosk') : p.source === 'mobile_app' ? t('Mobile App') : p.source === 'qr_code' ? t('QR Code') : (p.source || '');
                  const expKey = `ticket-${p.id}`;
                  const isExpanded = expandedPendingId === expKey;
                  const createdStr = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : locale === 'en' ? 'en-GB' : 'fr-FR', {
                    hour: '2-digit', minute: '2-digit', hour12: false,
                    day: '2-digit', month: 'short',
                  }).format(new Date(p.created_at));
                  return (
                    <div
                      key={p.id}
                      style={{
                        padding: '6px 8px',
                        background: isExpanded ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.08)',
                        border: '1px solid rgba(245,158,11,0.35)',
                        borderLeft: '3px solid #f59e0b',
                        borderRadius: 6,
                        opacity: busy ? 0.55 : 1,
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                        onClick={() => setExpandedPendingId(prev => prev === expKey ? null : expKey)}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: 1.2 }}>
                            <span style={{ fontSize: 8, color: 'var(--text3, #94a3b8)', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                            <span style={{ fontWeight: 800, color: 'var(--text, #f1f5f9)' }}>{p.ticket_number || '—'}</span>
                            <span style={{ fontWeight: 600, color: 'var(--text2, #cbd5e1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {cd.name || t('(no name)')}
                            </span>
                            {!isExpanded && cd.phone && <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, direction: 'ltr', unicodeBidi: 'embed' }}>{cd.phone}</span>}
                          </div>
                          {!isExpanded && (
                            <div style={{ fontSize: 9, color: 'var(--text3, #94a3b8)', marginTop: 1, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              <span style={{ color: '#f59e0b', fontWeight: 700 }}>{waitedMin > 0 ? t('{n}m ago', { n: waitedMin }) : t('now')}</span>
                              {sourceLabel && <span>· {sourceLabel}</span>}
                              {svcName && <span>· {svcName}</span>}
                              {cd.wilaya && <span>· 📍 {normalizeWilayaDisplay(cd.wilaya)}</span>}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 3 }} onClick={e => e.stopPropagation()}>
                          <button
                            disabled={busy}
                            onClick={() => moderatePendingTicket(p.id, 'approve')}
                            title={t('Approve')}
                            style={{
                              padding: '4px 8px', borderRadius: 5, border: '1px solid #22c55e60',
                              background: '#22c55e22', color: '#22c55e', cursor: busy ? 'wait' : 'pointer',
                              fontSize: 12, fontWeight: 800,
                            }}
                          >✓</button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt(t('Decline this ticket? The customer will be notified.\n\nReason (optional):'), '');
                              if (reason === null) return;
                              moderatePendingTicket(p.id, 'decline', reason.trim() || undefined);
                            }}
                            title={t('Decline')}
                            style={{
                              padding: '4px 8px', borderRadius: 5, border: '1px solid #ef444460',
                              background: '#ef444422', color: '#ef4444', cursor: busy ? 'wait' : 'pointer',
                              fontSize: 12, fontWeight: 800,
                            }}
                          >✕</button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{
                          marginTop: 6, paddingTop: 6,
                          borderTop: '1px solid rgba(245,158,11,0.2)',
                          display: 'flex', flexDirection: 'column', gap: 4,
                          fontSize: 11, color: 'var(--text2, #cbd5e1)',
                        }}>
                          {cd.name && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Name')}</span>
                              <span dir="auto" style={{ fontWeight: 600, unicodeBidi: 'isolate' }}>{cd.name}</span>
                            </div>
                          )}
                          {cd.phone && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Phone')}</span>
                              <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{cd.phone}</span>
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Created')}</span>
                            <span>{createdStr}</span>
                            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 10 }}>({waitedMin > 0 ? t('{n}m ago', { n: waitedMin }) : t('now')})</span>
                          </div>
                          {sourceLabel && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Source')}</span>
                              <span>{sourceLabel}</span>
                            </div>
                          )}
                          {svcName && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Service')}</span>
                              <span>{svcName}</span>
                            </div>
                          )}
                          {deptName && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Department')}</span>
                              <span>{deptName}</span>
                            </div>
                          )}
                          {cd.wilaya && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Wilaya')}</span>
                              <span dir="auto" style={{ unicodeBidi: 'isolate' }}>📍 {normalizeWilayaDisplay(cd.wilaya)}</span>
                            </div>
                          )}
                          {cd.notes && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Notes')}</span>
                              <span dir="auto" style={{ fontStyle: 'italic', unicodeBidi: 'isolate', wordBreak: 'break-word' }}>{cd.notes}</span>
                            </div>
                          )}
                          {cd.email && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text3, #94a3b8)', fontSize: 10, minWidth: 55 }}>{t('Email')}</span>
                              <span>{cd.email}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Section 2: Today's appointments ── */}
            {pendingApptsToday.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{
                  fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
                  color: '#f59e0b', marginBottom: 6, paddingBottom: 4,
                  borderBottom: '1px solid rgba(245,158,11,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span>📅 {t('Today\'s appointments')}</span>
                  <span style={{ background: '#f59e0b', color: '#000', borderRadius: 10, padding: '1px 7px', fontSize: 9 }}>
                    {pendingApptsToday.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pendingApptsToday.map((a) => renderPendingApptCard(a, { showDate: false }))}
                </div>
              </div>
            )}

            {/* ── Section 3: Upcoming reservations (grouped by day) ── */}
            {pendingApptsUpcoming.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{
                  fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
                  color: '#f59e0b', marginBottom: 6, paddingBottom: 4,
                  borderBottom: '1px solid rgba(245,158,11,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span>📆 {t('Upcoming reservations')}</span>
                  <span style={{ background: '#f59e0b', color: '#000', borderRadius: 10, padding: '1px 7px', fontSize: 9 }}>
                    {pendingApptsUpcoming.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pendingApptsUpcomingGrouped.map((g) => (
                    <div key={g.label}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: 'var(--text3, #94a3b8)',
                        marginBottom: 4, paddingLeft: 2, textTransform: 'capitalize',
                      }}>
                        {g.label} · {g.items.length}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {g.items.map((a) => renderPendingApptCard(a, { showDate: false }))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {queueTab === 'queue' && (<>
        <div className="sidebar-section queue-list queue-waiting">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 6 }}>
            <h4 style={{ margin: 0 }}>{t('Waiting ({count})', { count: waiting.length })}</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
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
              <button
                onClick={() => { setShowBroadcast(true); fetchBroadcastTemplates(); }}
                title={t('Broadcast')}
                aria-label={t('Broadcast')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 14,
                  border: '1.5px solid rgba(14,165,233,0.4)',
                  background: 'rgba(14,165,233,0.12)',
                  cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  color: '#0ea5e9', whiteSpace: 'nowrap',
                }}
              >
                {'\u{1F4E2}'} {t('Broadcast')}
              </button>
            </div>
          </div>
          <div className="ticket-list" role="list" aria-label={t('Waiting tickets')}>
            {visibleWaiting.map((ticket, i) => {
              // Office-wide position in the canonically-sorted waiting list.
              // The full `waiting` array is sorted by priority DESC + created_at ASC,
              // matching the canonical getQueuePosition() formula on the server.
              const officePosition = waiting.findIndex((tt) => tt.id === ticket.id) + 1;
              return (
              <div key={ticket.id} className="queue-item" role="listitem"
                aria-label={translate(locale, 'Position {position}, ticket {ticket}, {name}, waiting {wait}', { position: officePosition, ticket: ticket.ticket_number, name: getTicketCustomerName(ticket.customer_data) ?? translate(locale, 'Walk-in'), wait: formatWait(ticket.created_at) })}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, ticketId: ticket.id, ticketNumber: ticket.ticket_number }); }}
              >
                <div className="queue-item-pos" aria-hidden="true">#{officePosition}</div>
                <div className="queue-item-info">
                  <span className="queue-item-number">{ticket.ticket_number}</span>
                  {/*
                    dir="auto" is required so Arabic characters render in the
                    correct order, BUT it also flips `text-align: start` to
                    right within the span — which visually pushed the name to
                    the far edge and left a big empty gap under the ticket
                    number. Force `text-align: left` so the block always sits
                    flush-left regardless of the script inside it.
                  */}
                  <span dir="auto" style={{ display: 'block', fontSize: 11, color: 'var(--text3)', unicodeBidi: 'isolate', textAlign: 'left' }}>
                    {getTicketCustomerName(ticket.customer_data) ?? translate(locale, 'Walk-in')}
                  </span>
                  {getTicketCustomerPhone(ticket.customer_data) && (
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--text3)', opacity: 0.8, direction: 'ltr', unicodeBidi: 'embed', textAlign: 'left' }}>
                      {getTicketCustomerPhone(ticket.customer_data)}
                    </span>
                  )}
                </div>
                <span className="queue-item-meta" style={{ whiteSpace: 'nowrap', flexShrink: 0, ...waitStyle(ticket.created_at) }}>{formatWait(ticket.created_at)}</span>
                <div className="queue-item-badges">
                  {ticket.priority > 1 && <span className="badge priority">P{ticket.priority}</span>}
                  {(ticket.appointment_id || ticket.source === 'appointment') && <span className="badge booked" style={{ background: '#3b82f622', color: '#3b82f6', border: '1px solid #3b82f640' }}>📅 {translate(locale, 'Booked')}</span>}
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
            );})}
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
              <div className="queue-empty">
                {searchFilter ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <span>{t('No matches for "{query}"', { query: searchFilter })}</span>
                    <button
                      type="button"
                      onClick={() => setSearchFilter('')}
                      style={{
                        fontSize: 11, fontWeight: 600,
                        padding: '4px 10px', borderRadius: 6,
                        border: '1px solid rgba(59,130,246,0.4)',
                        background: 'rgba(59,130,246,0.12)',
                        color: '#60a5fa', cursor: 'pointer',
                      }}
                    >
                      {t('Clear filter')}
                    </button>
                  </div>
                ) : (
                  t('No customers waiting')
                )}
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-section queue-list queue-active">
          <h4>{t('Active ({count})', { count: called.length + serving.length + parked.length })}</h4>
          <div className="ticket-list" role="list" aria-label={t('Active tickets')}>
            {[...called, ...serving].map((ticket) => (
              <div key={ticket.id} className={`queue-item ${ticket.desk_id === session.desk_id ? 'mine' : ''}`} role="listitem"
                aria-label={translate(locale, 'Ticket {ticket}, {status} at {desk}', { ticket: ticket.ticket_number, status: ticket.status === 'called' ? translate(locale, 'Called') : translate(locale, 'Serving'), desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') })}>
                <div className="queue-item-dot" style={{ background: statusColor(ticket.status) }} aria-hidden="true" />
                <div className="queue-item-info">
                  <span className="queue-item-number">{ticket.ticket_number}</span>
                  <span className="queue-item-meta">
                    {ticket.status === 'called' ? translate(locale, 'Called at {desk}', { desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') }) : translate(locale, 'Serving at {desk}', { desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') })}
                  </span>
                  {getTicketCustomerName(ticket.customer_data) || getTicketCustomerPhone(ticket.customer_data) ? (
                    <span className="queue-item-meta" dir="auto" style={{ unicodeBidi: 'isolate' }}>
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
        </>)}


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
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: locale === 'ar' ? 'none' as const : 'uppercase' as const, letterSpacing: locale === 'ar' ? 'normal' : 1, margin: '0 0 8px' }}>
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

        {/* Recent Activity moved to the main canvas idle panel (see idle-panel above). */}

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
                type="button"
                onClick={() => setShowDevices((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  padding: '6px 0', border: 'none', background: 'transparent', cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: locale === 'ar' ? 'none' as const : 'uppercase' as const, letterSpacing: locale === 'ar' ? 'normal' : 1, margin: 0, pointerEvents: 'none' }}>
                  {isRemote ? t('Remote Access') : t('Devices & Network')}
                </h4>
                <span style={{ fontSize: 12, color: 'var(--text3)', minWidth: 24, minHeight: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>{showDevices ? '▲' : '▼'}</span>
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
        {!isSmallScreen && <RemoteSupportSection t={t} locale={locale} />}
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
            addActivity(activeTicket.ticket_number, `→ ${deskName}`, activeTicket.id);
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

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                disabled={broadcastSending || (!broadcastMsg.fr && !broadcastMsg.ar)}
                onClick={async () => { await sendBroadcast(broadcastMsg); }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8,
                  border: 'none', background: '#0ea5e9', color: '#fff', fontSize: 14,
                  fontWeight: 700, cursor: broadcastSending ? 'wait' : 'pointer',
                  opacity: broadcastSending || (!broadcastMsg.fr && !broadcastMsg.ar) ? 0.5 : 1,
                }}
              >
                {broadcastSending ? t('Sending...') : t('Send to all waiting')}
              </button>
              <button
                disabled={!broadcastMsg.fr && !broadcastMsg.ar}
                onClick={() => setBroadcastShowSave(v => !v)}
                style={{
                  padding: '10px 14px', borderRadius: 8,
                  border: '1px solid var(--border)', background: broadcastShowSave ? 'var(--surface2)' : 'transparent',
                  color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  opacity: (!broadcastMsg.fr && !broadcastMsg.ar) ? 0.4 : 1,
                }}
                title={t('Save as Template')}
              >
                💾
              </button>
            </div>

            {/* Save template form */}
            {broadcastShowSave && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>{t('Save as Template')}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={broadcastTemplateName}
                    onChange={(e) => setBroadcastTemplateName(e.target.value)}
                    placeholder={t('Template Name')}
                    style={{
                      flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--surface)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
                    }}
                  />
                  <input
                    type="text"
                    value={broadcastTemplateShortcut}
                    onChange={(e) => setBroadcastTemplateShortcut(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3))}
                    placeholder="F1"
                    maxLength={3}
                    style={{
                      width: 50, padding: '7px 6px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--surface)', color: 'var(--text)', fontSize: 13, textAlign: 'center',
                      fontWeight: 700, boxSizing: 'border-box',
                    }}
                    title={t('Shortcut key')}
                  />
                  <button
                    disabled={!broadcastTemplateName.trim()}
                    onClick={async () => {
                      await saveBroadcastTemplate(broadcastTemplateName.trim(), broadcastMsg.fr, broadcastMsg.ar, broadcastTemplateShortcut.trim() || undefined);
                      setBroadcastShowSave(false);
                      setBroadcastTemplateName('');
                      setBroadcastTemplateShortcut('');
                    }}
                    style={{
                      padding: '7px 14px', borderRadius: 6, border: 'none',
                      background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 700,
                      cursor: !broadcastTemplateName.trim() ? 'default' : 'pointer',
                      opacity: !broadcastTemplateName.trim() ? 0.4 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('Save')}
                  </button>
                </div>
              </div>
            )}

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

            {/* Templates — quick send with shortcuts */}
            {broadcastTemplates.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 6 }}>{t('Templates')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {broadcastTemplates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                        background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)',
                      }}
                    >
                      {tmpl.shortcut && (
                        <span style={{
                          display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                          fontSize: 10, fontWeight: 700, color: 'var(--text3)', fontFamily: 'monospace',
                          minWidth: 24, textAlign: 'center',
                        }}>
                          {tmpl.shortcut}
                        </span>
                      )}
                      <button
                        onClick={() => {
                          setBroadcastMsg({ fr: tmpl.body_fr ?? '', ar: tmpl.body_ar ?? '' });
                        }}
                        style={{
                          flex: 1, textAlign: 'left', background: 'none', border: 'none',
                          color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                        title={tmpl.body_fr || tmpl.body_ar || ''}
                      >
                        {tmpl.title}
                      </button>
                      <button
                        disabled={broadcastSending}
                        onClick={async () => {
                          await sendBroadcast({ fr: tmpl.body_fr ?? '', ar: tmpl.body_ar ?? '' });
                        }}
                        style={{
                          padding: '3px 10px', borderRadius: 6, border: 'none',
                          background: '#0ea5e9', color: '#fff', fontSize: 11, fontWeight: 700,
                          cursor: broadcastSending ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                          opacity: broadcastSending ? 0.5 : 1,
                        }}
                      >
                        {t('Send')}
                      </button>
                      <button
                        onClick={() => deleteBroadcastTemplate(tmpl.id)}
                        style={{
                          padding: '3px 6px', borderRadius: 6, border: 'none',
                          background: 'none', color: 'var(--text3)', fontSize: 13,
                          cursor: 'pointer', lineHeight: 1,
                        }}
                        title={t('Delete')}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Close */}
            <button
              onClick={() => { setShowBroadcast(false); setBroadcastResult(null); setBroadcastShowSave(false); }}
              style={{
                marginTop: 14, width: '100%', padding: '10px', border: '1px solid var(--border)',
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

// ─────────────────────────────────────────────────────────────────────
// Inline ticket details panel
// Rendered directly beneath a Recent Activity row when the operator
// clicks it — shows customer data, timestamps, and the audit timeline
// without a modal overlay.
// ─────────────────────────────────────────────────────────────────────
function InlineTicketDetails({
  loading,
  data,
  locale,
  t,
  onFindInWaiting,
}: {
  loading: boolean;
  data: { events: any[]; ticket: any } | null;
  locale: 'en' | 'fr' | 'ar';
  t: (k: string, p?: Record<string, any>) => string;
  onFindInWaiting: (ticketNumber: string) => void;
}) {
  const ticket = data?.ticket;
  const events = data?.events ?? [];
  const customerData: Record<string, any> = ticket?.customer_data ?? {};
  const statusColor: Record<string, string> = {
    waiting: '#3b82f6', called: '#8b5cf6', serving: '#22c55e',
    served: '#16a34a', no_show: '#f97316', cancelled: '#ef4444',
  };

  return (
    <div style={{
      borderLeft: '1px solid rgba(59,130,246,0.35)',
      borderRight: '1px solid rgba(59,130,246,0.35)',
      borderBottom: '1px solid rgba(59,130,246,0.35)',
      borderRadius: '0 0 10px 10px',
      background: 'rgba(59,130,246,0.04)',
      padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 18,
      direction: locale === 'ar' ? 'rtl' : 'ltr',
      textAlign: locale === 'ar' ? 'right' : 'left',
    }}>
      {loading ? (
        <div style={{ color: 'var(--text3)', fontSize: 14 }}>{t('Loading…')}</div>
      ) : !ticket ? (
        <div style={{ color: 'var(--text3)', fontSize: 14 }}>{t('Ticket not found')}</div>
      ) : (
        <>
          {/* Status + quick meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 12, fontWeight: 800, padding: '5px 14px', borderRadius: 12,
              background: `${statusColor[ticket.status] || '#64748b'}22`,
              color: statusColor[ticket.status] || '#64748b',
              textTransform: 'uppercase', letterSpacing: 1,
            }}>
              {t(ticket.status)}
            </span>
            {ticket.priority > 0 && (
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>
                {t('Priority')}: {ticket.priority}
              </span>
            )}
            {ticket.recall_count > 0 && (
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>
                {t('Recalls')}: {ticket.recall_count}
              </span>
            )}
            {ticket.is_remote ? <span style={{ fontSize: 13, color: 'var(--text3)' }}>· {t('Remote')}</span> : null}
            {ticket.source ? <span style={{ fontSize: 13, color: 'var(--text3)' }}>· {t(ticket.source)}</span> : null}
          </div>

          {/* Customer data */}
          {Object.keys(customerData).length > 0 && (
            <section style={{ textAlign: 'start' }}>
              <h5 style={{
                margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: 'var(--text2)',
                letterSpacing: 1.1, textTransform: 'uppercase', textAlign: 'start',
              }}>{t('Customer')}</h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                {Object.entries(customerData).filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                  <div key={k} style={{
                    display: 'flex', justifyContent: 'space-between', gap: 16,
                    padding: '4px 0', borderBottom: '1px dashed rgba(148,163,184,0.12)',
                  }}>
                    <span style={{ color: 'var(--text3)', textTransform: 'capitalize', textAlign: 'start' }}>{k}</span>
                    <span style={{ color: 'var(--text)', textAlign: 'end' }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Timestamps */}
          <section style={{ textAlign: 'start' }}>
            <h5 style={{
              margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: 'var(--text2)',
              letterSpacing: 1.1, textTransform: 'uppercase', textAlign: 'start',
            }}>{t('Timestamps')}</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
              {([
                ['created_at', t('Created')],
                ['called_at', t('Called')],
                ['serving_started_at', t('Serving started')],
                ['completed_at', t('Completed')],
                ['cancelled_at', t('Cancelled')],
                ['parked_at', t('Parked')],
              ] as const).filter(([k]) => ticket[k]).map(([k, label]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 16,
                  padding: '4px 0', borderBottom: '1px dashed rgba(148,163,184,0.12)',
                }}>
                  <span style={{ color: 'var(--text3)', textAlign: 'start' }}>{label}</span>
                  <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', textAlign: 'end' }}>
                    {formatDesktopTime(ticket[k], locale)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Audit timeline */}
          {events.length > 0 && (
            <section style={{ textAlign: 'start' }}>
              <h5 style={{
                margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: 'var(--text2)',
                letterSpacing: 1.1, textTransform: 'uppercase', textAlign: 'start',
              }}>{t('Timeline')} ({events.length})</h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
                {events.map((ev, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    padding: '7px 12px', borderRadius: 8,
                    background: 'rgba(15,23,42,0.4)', fontSize: 13,
                  }}>
                    <span style={{ color: 'var(--text3)', fontVariantNumeric: 'tabular-nums', minWidth: 90 }}>
                      {formatDesktopTime(ev.created_at, locale)}
                    </span>
                    <span style={{ color: 'var(--text)', flex: 1 }}>
                      <strong>{t(ev.to_status || ev.event_type)}</strong>
                      {ev.from_status && ev.to_status && ev.from_status !== ev.to_status && (
                        <span style={{ color: 'var(--text3)' }}> ({t(ev.from_status)} → {t(ev.to_status)})</span>
                      )}
                      {ev.source && <span style={{ color: 'var(--text3)' }}> · {t(ev.source)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Actions */}
          {ticket.status === 'waiting' && (
            <div>
              <button
                onClick={() => onFindInWaiting(ticket.ticket_number)}
                style={{
                  background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                  border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8,
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {t('Find in waiting list')}
              </button>
            </div>
          )}
        </>
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
