import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { ALGERIA_WILAYAS, BLOOD_TYPES, getCommunes } from '../lib/algeria-wilayas';
import { parseExcelFile, parseCsvText, fetchGoogleSheet, type ParsedCustomerRow } from '../lib/customer-import';
import { GoogleSheetsModal } from './GoogleSheetsModal';
import { normalizePhone } from '@qflo/shared';

interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  visit_count: number;
  last_visit_at: string | null;
  last_booking_at?: string | null;
  booking_count?: number | null;
  notes?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  blood_type?: string | null;
  file_number?: string | null;
  address?: string | null;
  wilaya_code?: string | null;
  city?: string | null;
  is_couple?: boolean | null;
  spouse_name?: string | null;
  spouse_dob?: string | null;
  spouse_blood_type?: string | null;
  spouse_gender?: string | null;
  marriage_date?: string | null;
  created_at?: string | null;
}

const CUSTOMER_SELECT = 'id, name, phone, email, visit_count, last_visit_at, last_booking_at, booking_count, notes, gender, date_of_birth, blood_type, file_number, address, wilaya_code, city, is_couple, spouse_name, spouse_dob, spouse_blood_type, spouse_gender, marriage_date, created_at';

type SortKey = 'name' | 'last_visit' | 'bookings' | 'created';
type GroupKey = 'none' | 'wilaya' | 'city' | 'gender' | 'visit_month';

interface Props {
  organizationId: string;
  locale: DesktopLocale;
  storedAuth?: { access_token?: string; refresh_token?: string; email?: string; password?: string };
  onClose: () => void;
  onBookCustomer?: (customer: { name: string; phone: string; notes?: string }) => void;
  initialPhone?: string;
  timezone?: string;
}

function initials(name: string | null, phone: string | null) {
  const src = (name && name.trim()) || (phone && phone.trim()) || '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function avatarColor(seed: string) {
  const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/** Display phone: strip any '+' and country-code noise, show digits as stored. */
function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  // Strip common country codes so numbers display in local format.
  // Algeria: 213XXXXXXXXX → 0XXXXXXXXX
  if (digits.startsWith('213') && (digits.length === 12 || digits.length === 11)) {
    digits = '0' + digits.slice(3);
  } else if (digits.startsWith('1') && digits.length === 11) {
    // US/Canada: 1XXXXXXXXXX → XXXXXXXXXX
    digits = digits.slice(1);
  } else if (digits.startsWith('33') && digits.length === 11) {
    // France: 33XXXXXXXXX → 0XXXXXXXXX
    digits = '0' + digits.slice(2);
  }
  return digits;
}

/** Normalize phone for storage: always LOCAL format, no country code.
 *  "0669864728" stays "0669864728", "213669864728" → "0669864728",
 *  "+16612346622" → "6612346622" */
function normalizePhoneForStorage(input: string, tz?: string): string {
  const digits = (input ?? '').replace(/\D/g, '');
  if (!digits) return '';

  // First normalize to E.164 via shared normalizer
  const e164 = normalizePhone(input, tz);
  if (!e164) return digits;

  // Convert E.164 back to local (strip country code)
  // Algeria (213)
  if (e164.startsWith('213') && e164.length === 12) return '0' + e164.slice(3);
  // US/Canada (1)
  if (e164.startsWith('1') && e164.length === 11) return e164.slice(1);
  // France (33)
  if (e164.startsWith('33') && e164.length === 11) return '0' + e164.slice(2);
  // Morocco (212)
  if (e164.startsWith('212') && e164.length === 12) return '0' + e164.slice(3);
  // Tunisia (216)
  if (e164.startsWith('216') && e164.length === 11) return e164.slice(3);

  return digits; // fallback: just digits
}

function timeAgo(iso: string | null, t: (k: string, v?: any) => string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86400000;
  if (diff < day) return t('Today');
  const days = Math.floor(diff / day);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function CustomersModal({ organizationId, locale, storedAuth, onClose, onBookCustomer, initialPhone, timezone }: Props) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCompose, setShowCompose] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const orgIdRef = useRef<string>('');

  // Filter / sort / group state
  const [filterWilaya, setFilterWilaya] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterGender, setFilterGender] = useState('');
  const [filterBlood, setFilterBlood] = useState('');
  const [filterCoupleOnly, setFilterCoupleOnly] = useState(false);
  const [filterVisitMonth, setFilterVisitMonth] = useState(''); // '' | 'this' | 'last' | 'YYYY-MM'
  const [sortKey, setSortKey] = useState<SortKey>('last_visit');
  const [sortDesc, setSortDesc] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupKey>('none');
  const [showFilters, setShowFilters] = useState(false);

  // Detail / edit panel
  const [detail, setDetail] = useState<Customer | null>(null);
  const [detailForm, setDetailForm] = useState<Partial<Customer>>({});
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Backwards compat helpers
  const detailName = detailForm.name ?? '';
  const detailPhone = detailForm.phone ?? '';
  const detailEmail = detailForm.email ?? '';
  const detailNotes = detailForm.notes ?? '';
  const setDetailName = (v: string) => setDetailForm(f => ({ ...f, name: v }));
  const setDetailPhone = (v: string) => setDetailForm(f => ({ ...f, phone: v }));
  const setDetailEmail = (v: string) => setDetailForm(f => ({ ...f, email: v }));
  const setDetailNotes = (v: string) => setDetailForm(f => ({ ...f, notes: v }));
  const setDetailField = <K extends keyof Customer>(k: K, v: Customer[K]) =>
    setDetailForm(f => ({ ...f, [k]: v }));

  function openDetail(c: Customer) {
    setDetail(c);
    setDetailForm({
      ...c,
      phone: formatPhoneDisplay(c.phone),
    });
    setDetailError(null);
  }

  async function handleSaveDetail() {
    if (!detail) return;
    setDetailBusy(true);
    setDetailError(null);
    try {
      await resolveOrgId();
      const sb = await getSupabase();
      const f = detailForm;
      const updates: any = {
        name: (f.name ?? '').trim() || null,
        phone: normalizePhoneForStorage(f.phone ?? '', timezone),
        email: (f.email ?? '').trim() || null,
        notes: (f.notes ?? '').trim() || null,
        gender: f.gender || null,
        date_of_birth: f.date_of_birth || null,
        blood_type: f.blood_type || null,
        file_number: (f.file_number ?? '').trim() || null,
        address: (f.address ?? '').trim() || null,
        wilaya_code: f.wilaya_code || null,
        city: f.city || null,
        is_couple: !!f.is_couple,
        spouse_name: f.is_couple ? ((f.spouse_name ?? '').trim() || null) : null,
        spouse_dob: f.is_couple ? (f.spouse_dob || null) : null,
        spouse_blood_type: f.is_couple ? (f.spouse_blood_type || null) : null,
        spouse_gender: f.is_couple ? (f.spouse_gender || null) : null,
        marriage_date: f.is_couple ? (f.marriage_date || null) : null,
      };
      const { error: updErr } = await sb
        .from('customers')
        .update(updates)
        .eq('id', detail.id);
      if (updErr) {
        if ((updErr as any).code === '23505') setDetailError(t('A customer with this phone already exists.'));
        else setDetailError(updErr.message);
        return;
      }
      // Refetch the row separately to avoid PostgREST "single object" coercion issues under RLS
      const { data: updated } = await sb
        .from('customers')
        .select(CUSTOMER_SELECT)
        .eq('id', detail.id)
        .maybeSingle();
      if (updated) {
        const u = updated as Customer;
        setCustomers((prev) => prev.map((c) => (c.id === u.id ? u : c)));
      }
      setDetail(null);
    } catch (e: any) {
      setDetailError(e?.message ?? String(e));
    } finally {
      setDetailBusy(false);
    }
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(t('Delete {n} selected customers? This cannot be undone.', { n: selected.size }))) return;
    try {
      const sb = await getSupabase();
      const ids = Array.from(selected);
      const { error: delErr } = await sb.from('customers').delete().in('id', ids);
      if (delErr) { alert(delErr.message); return; }
      setCustomers((prev) => prev.filter((c) => !selected.has(c.id)));
      setSelected(new Set());
    } catch (e: any) {
      alert(e?.message ?? String(e));
    }
  }

  async function handleDeleteDetail() {
    if (!detail) return;
    if (!confirm(t('Delete this customer?'))) return;
    setDetailBusy(true);
    setDetailError(null);
    try {
      const sb = await getSupabase();
      const { error: delErr } = await sb.from('customers').delete().eq('id', detail.id);
      if (delErr) { setDetailError(delErr.message); return; }
      setCustomers((prev) => prev.filter((c) => c.id !== detail.id));
      setSelected((prev) => { const next = new Set(prev); next.delete(detail.id); return next; });
      setDetail(null);
    } catch (e: any) {
      setDetailError(e?.message ?? String(e));
    } finally {
      setDetailBusy(false);
    }
  }

  // Add customer form (uses a single form object)
  const emptyAddForm: Partial<Customer> = {
    name: '', phone: '', email: '', notes: '',
    gender: '', date_of_birth: '', blood_type: '',
    address: '', wilaya_code: '', city: '',
    is_couple: false, spouse_name: '', spouse_dob: '', spouse_blood_type: '', spouse_gender: '', marriage_date: '',
  };
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<Partial<Customer>>(emptyAddForm);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const setAddField = <K extends keyof Customer>(k: K, v: any) =>
    setAddForm(f => ({ ...f, [k]: v }));
  const addName = addForm.name ?? '';
  const addPhone = addForm.phone ?? '';

  // Import modal state
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<ParsedCustomerRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');

  // Google Sheets sync state
  const [showGoogleSheets, setShowGoogleSheets] = useState(false);
  const [gConnected, setGConnected] = useState(false);
  const [gAutoSync, setGAutoSync] = useState(false);

  const resolveOrgId = useCallback(async (): Promise<string> => {
    if (orgIdRef.current) return orgIdRef.current;
    await ensureAuth(storedAuth);
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

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      const { data, error } = await sb
        .from('customers')
        .select(CUSTOMER_SELECT)
        .eq('organization_id', orgId)
        .order('last_visit_at', { ascending: false, nullsFirst: false })
        .limit(5000);
      if (error) setError(error.message);
      else setCustomers((data ?? []) as Customer[]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [resolveOrgId]);

  async function handleAddCustomer() {
    setAddError(null);
    if (!addName.trim() || !addPhone.trim()) {
      setAddError(t('Name and phone are required'));
      return;
    }
    setAddBusy(true);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      const f = addForm;
      const { data: inserted, error: insErr } = await sb
        .from('customers')
        .insert({
          organization_id: orgId,
          name: (f.name ?? '').trim(),
          phone: normalizePhoneForStorage(f.phone ?? '', timezone),
          email: (f.email ?? '').trim() || null,
          notes: (f.notes ?? '').trim() || null,
          gender: f.gender || null,
          date_of_birth: f.date_of_birth || null,
          blood_type: f.blood_type || null,
          address: (f.address ?? '').trim() || null,
          wilaya_code: f.wilaya_code || null,
          city: f.city || null,
          is_couple: !!f.is_couple,
          spouse_name: f.is_couple ? ((f.spouse_name ?? '').trim() || null) : null,
          spouse_dob: f.is_couple ? (f.spouse_dob || null) : null,
          spouse_blood_type: f.is_couple ? (f.spouse_blood_type || null) : null,
          spouse_gender: f.is_couple ? (f.spouse_gender || null) : null,
          marriage_date: f.is_couple ? (f.marriage_date || null) : null,
          visit_count: 0,
          source: 'station',
        } as any)
        .select('id')
        .maybeSingle();
      if (insErr) {
        if ((insErr as any).code === '23505') {
          setAddError(t('A customer with this phone already exists.'));
        } else {
          setAddError(insErr.message);
        }
        return;
      }
      if (inserted?.id) {
        const { data: full } = await sb.from('customers').select(CUSTOMER_SELECT).eq('id', inserted.id).maybeSingle();
        if (full) setCustomers((prev) => [full as Customer, ...prev]);
      } else {
        await loadCustomers();
      }
      setAddForm(emptyAddForm);
      setShowAdd(false);
    } catch (e: any) {
      setAddError(e?.message ?? String(e));
    } finally {
      setAddBusy(false);
    }
  }

  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = (visibleIds: string[], allOn: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (allOn) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    return next;
  });

  async function handleSend() {
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const accessToken = await ensureAuth(storedAuth);
      if (!accessToken) throw new Error('Not authenticated');

      const res = await fetch('https://qflo.net/api/customer-broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          customerIds: Array.from(selected),
          message: composeText,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setSendResult({ sent: json.sent ?? 0, failed: json.failed ?? 0 });
    } catch (e: any) {
      setSendError(e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // Auto-open customer profile when initialPhone is provided
  const initialPhoneHandled = useRef(false);
  useEffect(() => {
    if (!initialPhone || initialPhoneHandled.current || loading || customers.length === 0) return;
    initialPhoneHandled.current = true;
    const normalizedInput = initialPhone.replace(/\D/g, '');
    const match = customers.find(c => {
      const normalizedCustomer = (c.phone ?? '').replace(/\D/g, '');
      return normalizedCustomer === normalizedInput
        || normalizedCustomer.endsWith(normalizedInput)
        || normalizedInput.endsWith(normalizedCustomer);
    });
    if (match) openDetail(match);
  }, [initialPhone, loading, customers]);

  async function handleImportRows(rows: ParsedCustomerRow[]) {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      const payload = rows
        .map(r => ({
          organization_id: orgId,
          name: (r.name ?? '').trim() || null,
          phone: r.phone ? normalizePhoneForStorage(r.phone, timezone) : null,
          email: r.email || null,
          notes: r.notes || null,
          gender: r.gender === 'male' || r.gender === 'female' ? r.gender : null,
          date_of_birth: r.date_of_birth || null,
          blood_type: r.blood_type || null,
          file_number: r.file_number || null,
          address: r.address || null,
          wilaya_code: r.wilaya_code || null,
          city: r.city || null,
          is_couple: !!r.is_couple,
          spouse_name: r.spouse_name || null,
          spouse_dob: r.spouse_dob || null,
          spouse_blood_type: r.spouse_blood_type || null,
          spouse_gender: r.spouse_gender === 'male' || r.spouse_gender === 'female' ? r.spouse_gender : null,
          marriage_date: r.marriage_date || null,
          source: 'import',
          visit_count: 0,
        }))
        .filter(p => p.phone || p.name);
      if (payload.length === 0) { setImportError(t('No valid rows to import')); return; }
      // Upsert by (organization_id, phone) — ignore duplicates
      const { data: ins, error: insErr } = await sb
        .from('customers')
        .upsert(payload as any, { onConflict: 'organization_id,phone', ignoreDuplicates: true })
        .select('id');
      if (insErr) { setImportError(insErr.message); return; }
      const inserted = ins?.length ?? 0;
      setImportResult({ inserted, skipped: payload.length - inserted });
      await loadCustomers();
    } catch (e: any) {
      setImportError(e?.message ?? String(e));
    } finally {
      setImportBusy(false);
    }
  }

  // === GOOGLE SHEETS SYNC (status + background auto-push) ===
  const refreshGStatus = useCallback(async () => {
    try {
      const orgId = await resolveOrgId();
      const res = await fetch(`https://qflo.net/api/google/sheets/status?org=${encodeURIComponent(orgId)}`);
      if (res.ok) {
        const data = await res.json();
        setGConnected(!!data.connected);
        setGAutoSync(!!data.sheet?.autoSync);
      }
    } catch {}
  }, [resolveOrgId]);

  useEffect(() => { refreshGStatus(); }, [refreshGStatus]);
  // Refresh when modal closes (in case user changed something)
  useEffect(() => { if (!showGoogleSheets) refreshGStatus(); }, [showGoogleSheets, refreshGStatus]);

  // Auto-push every 5 minutes when connected & auto-sync enabled
  useEffect(() => {
    if (!gConnected || !gAutoSync) return;
    const id = window.setInterval(async () => {
      try {
        const orgId = await resolveOrgId();
        await fetch('https://qflo.net/api/google/sheets/push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: orgId }),
        });
      } catch {}
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [gConnected, gAutoSync, resolveOrgId]);

  // === FILTERS ===
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (q) {
        const hit =
          (c.name?.toLowerCase().includes(q) ?? false) ||
          (c.phone?.includes(q) ?? false) ||
          (formatPhoneDisplay(c.phone).includes(q)) ||
          (c.email?.toLowerCase().includes(q) ?? false) ||
          (c.file_number?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      if (filterWilaya && c.wilaya_code !== filterWilaya) return false;
      if (filterCity && c.city !== filterCity) return false;
      if (filterGender && c.gender !== filterGender) return false;
      if (filterBlood && c.blood_type !== filterBlood) return false;
      if (filterCoupleOnly && !c.is_couple) return false;
      if (filterVisitMonth) {
        const lv = c.last_visit_at ? new Date(c.last_visit_at) : null;
        if (!lv) return false;
        const now = new Date();
        if (filterVisitMonth === 'this') {
          if (lv.getFullYear() !== now.getFullYear() || lv.getMonth() !== now.getMonth()) return false;
        } else if (filterVisitMonth === 'last') {
          const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          if (lv.getFullYear() !== d.getFullYear() || lv.getMonth() !== d.getMonth()) return false;
        } else {
          // YYYY-MM
          const [y, m] = filterVisitMonth.split('-').map(Number);
          if (lv.getFullYear() !== y || lv.getMonth() + 1 !== m) return false;
        }
      }
      return true;
    }).sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = (a.name ?? '').localeCompare(b.name ?? ''); break;
        case 'bookings': cmp = (a.booking_count ?? 0) - (b.booking_count ?? 0); break;
        case 'created': cmp = (a.created_at ?? '').localeCompare(b.created_at ?? ''); break;
        case 'last_visit':
        default:
          cmp = (a.last_visit_at ?? '').localeCompare(b.last_visit_at ?? ''); break;
      }
      return sortDesc ? -cmp : cmp;
    });
  }, [customers, search, filterWilaya, filterCity, filterGender, filterBlood, filterCoupleOnly, filterVisitMonth, sortKey, sortDesc]);

  // Group rendering
  const grouped = useMemo(() => {
    if (groupBy === 'none') return [{ label: '', items: filtered }];
    const map = new Map<string, Customer[]>();
    for (const c of filtered) {
      let key = '—';
      if (groupBy === 'wilaya') {
        const w = ALGERIA_WILAYAS.find(x => x.code === c.wilaya_code);
        key = w ? `${w.code} — ${w.name}` : t('Unknown');
      } else if (groupBy === 'city') key = c.city || t('Unknown');
      else if (groupBy === 'gender') key = c.gender === 'male' ? t('Male') : c.gender === 'female' ? t('Female') : t('Unknown');
      else if (groupBy === 'visit_month') {
        if (!c.last_visit_at) key = t('Never');
        else {
          const d = new Date(c.last_visit_at);
          key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }
      }
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered, groupBy]);

  const stats = useMemo(() => {
    const total = customers.length;
    const totalVisits = customers.reduce((acc, c) => acc + (c.visit_count || 0), 0);
    const since = Date.now() - 30 * 86400000;
    const active30 = customers.filter((c) => c.last_visit_at && new Date(c.last_visit_at).getTime() >= since).length;
    const repeat = customers.filter((c) => (c.visit_count || 0) >= 2).length;
    return { total, totalVisits, active30, repeat };
  }, [customers]);

  const card: React.CSSProperties = {
    flex: 1, background: 'var(--bg, #0f172a)', border: '1px solid var(--border, #475569)', borderRadius: 8,
    padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  };

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
          background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 920,
          maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(59,130,246,0.08), transparent)',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>{t('Customers')}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
              {t('Showing {filtered} of {total} customers', { filtered: filtered.length, total: customers.length })}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
              width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>

        {/* Stat cards */}
        <div style={{ padding: '14px 22px 0', display: 'flex', gap: 10 }}>
          <div style={card}>
            <span style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('Total')}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{stats.total}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('Active (30d)')}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#22c55e' }}>{stats.active30}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('Repeat')}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#3b82f6' }}>{stats.repeat}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('Visits')}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{stats.totalVisits}</span>
          </div>
        </div>

        {/* Toolbar: compact action bar */}
        {(() => {
          const visibleIds = filtered.map((c) => c.id);
          const allOn = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
          const hasSel = selected.size > 0;
          const btnBase: React.CSSProperties = {
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 11px', borderRadius: 7, fontSize: 12, fontWeight: 500,
            cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1,
          };
          const btnGhost: React.CSSProperties = {
            ...btnBase,
            background: 'transparent',
            border: '1px solid var(--border, #475569)',
            color: 'var(--text2, #94a3b8)',
          };
          const btnPrimary: React.CSSProperties = {
            ...btnBase,
            background: 'var(--primary, #3b82f6)', color: '#fff', border: '1px solid var(--primary, #3b82f6)',
            fontWeight: 600,
          };
          return (
            <div style={{ padding: '12px 22px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Select all checkbox */}
              <label style={{ ...btnGhost, gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => toggleAllVisible(visibleIds, allOn)}
                  style={{ margin: 0, cursor: 'pointer' }}
                />
                <span>{hasSel ? t('{n} selected', { n: selected.size }) : t('Select all')}</span>
              </label>

              {/* Bulk actions appear inline when selection is active */}
              {hasSel && (
                <>
                  <button
                    onClick={() => { setShowCompose(true); setSendResult(null); setSendError(null); }}
                    style={{ ...btnBase, background: '#22c55e', color: '#fff', border: '1px solid #22c55e', fontWeight: 600 }}
                    title={t('Send WhatsApp to selected')}
                  >📨 {t('WhatsApp')} ({selected.size})</button>
                  <button
                    onClick={handleDeleteSelected}
                    style={{ ...btnBase, background: '#ef4444', color: '#fff', border: '1px solid #ef4444', fontWeight: 600 }}
                    title={t('Delete selected')}
                  >🗑 {t('Delete')} ({selected.size})</button>
                </>
              )}

              <div style={{ flex: 1 }} />

              {/* Right-side: passive utilities */}
              <button
                onClick={() => setShowFilters(s => !s)}
                style={{
                  ...btnGhost,
                  background: showFilters ? 'rgba(59,130,246,0.12)' : 'transparent',
                  borderColor: showFilters ? '#3b82f6' : 'var(--border, #475569)',
                  color: showFilters ? '#3b82f6' : 'var(--text2, #94a3b8)',
                }}
                title={t('Filters')}
              >⚙ {t('Filters')}</button>
              <button
                onClick={() => { setShowImport(true); setImportError(null); setImportResult(null); setImportRows([]); setSheetUrl(''); }}
                style={btnGhost}
                title={t('Import customers')}
              >⬆ {t('Import')}</button>
              <button
                onClick={() => setShowGoogleSheets(true)}
                title={gConnected ? t('Google Sheets sync (connected)') : t('Connect Google Sheets')}
                style={{
                  ...btnGhost,
                  background: gConnected ? 'rgba(16,185,129,0.12)' : 'transparent',
                  borderColor: gConnected ? '#10b981' : 'var(--border, #475569)',
                  color: gConnected ? '#10b981' : 'var(--text2, #94a3b8)',
                }}
              >📊 {t('Sheets')}{gConnected ? ' ✓' : ''}</button>

              {/* Send to all visible (only when no selection) */}
              {!hasSel && (
                <button
                  onClick={() => { setShowCompose(true); setSendResult(null); setSendError(null); }}
                  disabled={filtered.length === 0}
                  style={{
                    ...btnBase,
                    background: filtered.length === 0 ? 'transparent' : 'rgba(34,197,94,0.12)',
                    border: `1px solid ${filtered.length === 0 ? 'var(--border, #475569)' : '#22c55e'}`,
                    color: filtered.length === 0 ? 'var(--text3, #94a3b8)' : '#22c55e',
                    cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: filtered.length === 0 ? 0.5 : 1,
                  }}
                  title={t('Send WhatsApp to all visible')}
                >📨 {t('WhatsApp all')}</button>
              )}

              <button
                onClick={() => { setShowAdd(true); setAddError(null); }}
                style={btnPrimary}
              >+ {t('Add Customer')}</button>
            </div>
          );
        })()}

        {/* Filter panel */}
        {showFilters && (() => {
          const sel: React.CSSProperties = {
            padding: '6px 8px', borderRadius: 6, background: 'var(--bg, #0f172a)',
            border: '1px solid var(--border, #475569)', color: 'var(--text, #f1f5f9)', fontSize: 12,
          };
          const lbl: React.CSSProperties = { fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 };
          const communes = filterWilaya ? getCommunes(filterWilaya) : [];
          return (
            <div style={{
              margin: '10px 22px 0', padding: 12, borderRadius: 10,
              background: 'var(--bg, #0f172a)', border: '1px solid var(--border, #475569)',
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={lbl}>{t('Wilaya')}</span>
                <select style={sel} value={filterWilaya} onChange={(e) => { setFilterWilaya(e.target.value); setFilterCity(''); }}>
                  <option value="">{t('All')}</option>
                  {ALGERIA_WILAYAS.map(w => <option key={w.code} value={w.code}>{w.code} — {w.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={lbl}>{t('City')}</span>
                <select style={sel} value={filterCity} onChange={(e) => setFilterCity(e.target.value)} disabled={!filterWilaya}>
                  <option value="">{t('All')}</option>
                  {communes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={lbl}>{t('Gender')}</span>
                <select style={sel} value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                  <option value="">{t('All')}</option>
                  <option value="male">{t('Male')}</option>
                  <option value="female">{t('Female')}</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={lbl}>{t('Blood Type')}</span>
                <select style={sel} value={filterBlood} onChange={(e) => setFilterBlood(e.target.value)}>
                  <option value="">{t('All')}</option>
                  {BLOOD_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={lbl}>{t('Visit Month')}</span>
                <select style={sel} value={filterVisitMonth} onChange={(e) => setFilterVisitMonth(e.target.value)}>
                  <option value="">{t('Any')}</option>
                  <option value="this">{t('This month')}</option>
                  <option value="last">{t('Last month')}</option>
                  {(() => {
                    const opts: React.ReactNode[] = [];
                    const now = new Date();
                    for (let i = 2; i < 14; i++) {
                      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      opts.push(<option key={v} value={v}>{v}</option>);
                    }
                    return opts;
                  })()}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={lbl}>{t('Sort by')}</span>
                <select style={sel} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  <option value="last_visit">{t('Last Visit')}</option>
                  <option value="name">{t('Name')}</option>
                  <option value="bookings">{t('Bookings')}</option>
                  <option value="created">{t('Created')}</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={lbl}>{t('Order')}</span>
                <select style={sel} value={sortDesc ? 'desc' : 'asc'} onChange={(e) => setSortDesc(e.target.value === 'desc')}>
                  <option value="desc">{t('Descending')}</option>
                  <option value="asc">{t('Ascending')}</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={lbl}>{t('Group by')}</span>
                <select style={sel} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupKey)}>
                  <option value="none">{t('None')}</option>
                  <option value="wilaya">{t('Wilaya')}</option>
                  <option value="city">{t('City')}</option>
                  <option value="gender">{t('Gender')}</option>
                  <option value="visit_month">{t('Visit Month')}</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2, #94a3b8)', gridColumn: '1 / span 2' }}>
                <input type="checkbox" checked={filterCoupleOnly} onChange={(e) => setFilterCoupleOnly(e.target.checked)} />
                {t('Couple files only')}
              </label>
              <button
                onClick={() => {
                  setFilterWilaya(''); setFilterCity(''); setFilterGender(''); setFilterBlood('');
                  setFilterCoupleOnly(false); setFilterVisitMonth('');
                }}
                style={{
                  gridColumn: '3 / span 2', background: 'transparent', border: '1px solid var(--border, #475569)',
                  color: 'var(--text2, #94a3b8)', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                }}
              >{t('Reset filters')}</button>
            </div>
          );
        })()}

        {/* Search */}
        <div style={{ padding: '14px 22px 10px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3, #64748b)', fontSize: 14 }}>⌕</span>
            <input
              type="text"
              placeholder={t('Search by name, phone, or email...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px 10px 34px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                color: 'var(--text, #f1f5f9)', fontSize: 14, outline: 'none',
              }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 16px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text2, #94a3b8)', padding: 40 }}>{t('Loading...')}</p>
          ) : error ? (
            <p style={{ textAlign: 'center', color: 'var(--danger, #ef4444)', padding: 40 }}>{error}</p>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text3, #64748b)' }}>
              <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>👥</div>
              <p style={{ margin: 0 }}>{search ? t('No matches') : t('No customers found')}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {grouped.map((grp, gi) => (
                <div key={gi}>
                  {grp.label && (
                    <div style={{
                      margin: '10px 0 6px', padding: '6px 10px', borderRadius: 6,
                      background: 'rgba(59,130,246,0.08)', color: '#3b82f6',
                      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>{grp.label} · {grp.items.length}</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {grp.items.map((c) => {
                const seed = c.id || c.phone || c.name || 'x';
                return (
                  <div
                    key={c.id}
                    onClick={() => openDetail(c)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', borderRadius: 10,
                      background: 'var(--bg, #0f172a)', border: '1px solid var(--border, #475569)',
                      transition: 'border-color 0.15s, transform 0.15s',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border, #475569)'; }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleOne(c.id)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary, #3b82f6)', cursor: 'pointer' }}
                    />
                    <div style={{
                      width: 40, height: 40, borderRadius: 20, flexShrink: 0,
                      background: avatarColor(seed), color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13,
                    }}>{initials(c.name, c.phone)}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name || t('Unknown')}
                        </span>
                        {(c.visit_count || 0) >= 2 && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10,
                            background: 'rgba(59,130,246,0.15)', color: '#3b82f6', textTransform: 'uppercase',
                          }}>{t('Repeat')}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 2, fontSize: 12, color: 'var(--text3, #64748b)' }}>
                        {c.phone && <span style={{ direction: 'ltr' }}>📱 {formatPhoneDisplay(c.phone)}</span>}
                        {c.email && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✉ {c.email}</span>}
                      </div>
                      {c.notes && (
                        <div style={{
                          marginTop: 4, fontSize: 11, color: 'var(--text2, #94a3b8)',
                          fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', maxWidth: 480,
                        }}>📝 {c.notes}</div>
                      )}
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{c.visit_count || 0}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Visits')}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 48 }}>
                      <div style={{ fontSize: 12, color: 'var(--text2, #94a3b8)' }}>{timeAgo(c.last_visit_at, t)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Last Visit')}</div>
                    </div>
                  </div>
                );
              })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Customer detail / notes modal */}
      {detail && (
        <div
          onClick={(e) => { e.stopPropagation(); if (!detailBusy) setDetail(null); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
            zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 720,
              maxHeight: '88vh', border: '1px solid var(--border, #475569)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)',
              display: 'flex', alignItems: 'center', gap: 12,
              background: 'linear-gradient(180deg, rgba(59,130,246,0.08), transparent)',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 24, flexShrink: 0,
                background: avatarColor(detail.id), color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 16,
              }}>{initials(detail.name, detail.phone)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>
                  {detail.name || t('Unknown')}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
                  {(detail.visit_count || 0)} {t('Visits')} · {detail.last_visit_at ? timeAgo(detail.last_visit_at, t) : '—'}
                </p>
              </div>
              <button
                onClick={() => { if (!detailBusy) setDetail(null); }}
                style={{
                  background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
                  width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>

            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              {detail.file_number && (
                <div style={{ fontSize: 11, color: 'var(--text3, #64748b)' }}>
                  {t('File number')}: <span style={{ color: 'var(--text, #f1f5f9)', fontFamily: 'monospace' }}>{detail.file_number}</span>
                </div>
              )}
              <CustomerFormFields
                t={t}
                form={detailForm}
                setField={setDetailField as any}
                disabled={detailBusy}
              />
              {detailError && (
                <div style={{
                  padding: 10, borderRadius: 8,
                  background: 'rgba(239,68,68,0.12)', color: 'var(--danger, #ef4444)', fontSize: 13,
                }}>{detailError}</div>
              )}
            </div>

            <div style={{
              padding: '14px 22px', borderTop: '1px solid var(--border, #475569)',
              display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center',
            }}>
              <button
                onClick={handleDeleteDetail}
                disabled={detailBusy}
                style={{
                  background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: 'var(--danger, #ef4444)',
                  padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                }}
              >🗑 {t('Delete')}</button>
              <div style={{ display: 'flex', gap: 10 }}>
                {onBookCustomer && (
                  <button
                    onClick={() => {
                      if (!detail) return;
                      onBookCustomer({
                        name: detail.name ?? '',
                        phone: formatPhoneDisplay(detail.phone),
                        notes: detail.notes ?? '',
                      });
                      setDetail(null);
                      onClose();
                    }}
                    disabled={detailBusy}
                    style={{
                      background: 'var(--success, #22c55e)', color: '#fff', border: 'none',
                      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >📅 {t('Book In-House')}</button>
                )}
                <button
                  onClick={() => { if (!detailBusy) setDetail(null); }}
                  disabled={detailBusy}
                  style={{
                    background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                  }}
                >{t('Cancel')}</button>
                <button
                  onClick={handleSaveDetail}
                  disabled={detailBusy}
                  style={{
                    background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: detailBusy ? 'wait' : 'pointer', opacity: detailBusy ? 0.6 : 1,
                  }}
                >{detailBusy ? t('Saving...') : t('Save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Customer modal */}
      {showAdd && (
        <div
          onClick={(e) => { e.stopPropagation(); if (!addBusy) setShowAdd(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
            zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 460,
              border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>{t('Add Customer')}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
                {t('Saved to your organization and synced everywhere.')}
              </p>
            </div>
            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '65vh', overflowY: 'auto' }}>
              <CustomerFormFields
                t={t}
                form={addForm}
                setField={setAddField as any}
                disabled={addBusy}
              />
              {addError && (
                <div style={{
                  padding: 10, borderRadius: 8,
                  background: 'rgba(239,68,68,0.12)', color: 'var(--danger, #ef4444)', fontSize: 13,
                }}>{addError}</div>
              )}
            </div>
            <div style={{
              padding: '14px 22px', borderTop: '1px solid var(--border, #475569)',
              display: 'flex', gap: 10, justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => { if (!addBusy) setShowAdd(false); }}
                disabled={addBusy}
                style={{
                  background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                }}
              >{t('Cancel')}</button>
              <button
                onClick={handleAddCustomer}
                disabled={addBusy || !addName.trim() || !addPhone.trim()}
                style={{
                  background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: addBusy ? 'wait' : 'pointer',
                  opacity: addBusy || !addName.trim() || !addPhone.trim() ? 0.6 : 1,
                }}
              >{addBusy ? t('Saving...') : t('Save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Compose modal */}
      {showCompose && (
        <div
          onClick={(e) => { e.stopPropagation(); if (!sending) setShowCompose(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
            zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 520,
              border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>{t('Send WhatsApp')}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
                {selected.size > 0
                  ? t('Will send to {n} selected customers', { n: selected.size })
                  : t('Will send to {n} visible customers', { n: filtered.length })}
              </p>
            </div>
            <div style={{ padding: 22 }}>
              <textarea
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                placeholder={t('Hi {name}, ...')}
                rows={6}
                style={{
                  width: '100%', padding: 12, borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                  color: 'var(--text, #f1f5f9)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                }}
              />
              <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text3, #64748b)' }}>
                {t('Use {name} to personalize with each customer\'s name.')}
              </p>
              {sendResult && (
                <div style={{
                  marginTop: 14, padding: 12, borderRadius: 8,
                  background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: 13,
                }}>
                  ✓ {t('Sent {sent}, failed {failed}', { sent: sendResult.sent, failed: sendResult.failed })}
                </div>
              )}
              {sendError && (
                <div style={{
                  marginTop: 14, padding: 12, borderRadius: 8,
                  background: 'rgba(239,68,68,0.12)', color: 'var(--danger, #ef4444)', fontSize: 13,
                }}>{sendError}</div>
              )}
            </div>
            <div style={{
              padding: '14px 22px', borderTop: '1px solid var(--border, #475569)',
              display: 'flex', gap: 10, justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => { if (!sending) setShowCompose(false); }}
                disabled={sending}
                style={{
                  background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                }}
              >{sendResult ? t('Close') : t('Cancel')}</button>
              {!sendResult && (
                <button
                  onClick={() => {
                    if (!composeText.trim()) return;
                    if (selected.size === 0) {
                      // Auto-select all visible
                      setSelected(new Set(filtered.map((c) => c.id)));
                    }
                    handleSend();
                  }}
                  disabled={sending || !composeText.trim()}
                  style={{
                    background: 'var(--success, #22c55e)', color: '#fff', border: 'none',
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: sending ? 'wait' : 'pointer', opacity: sending || !composeText.trim() ? 0.6 : 1,
                  }}
                >{sending ? t('Sending...') : t('Send')}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div
          onClick={(e) => { e.stopPropagation(); if (!importBusy) setShowImport(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
            zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 600,
              maxHeight: '88vh', border: '1px solid var(--border, #475569)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>{t('Import Customers')}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
                {t('Upload Excel/CSV or paste a Google Sheets URL. Duplicates (same phone) are skipped.')}
              </p>
            </div>
            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text2, #94a3b8)', marginBottom: 6, fontWeight: 600 }}>
                  {t('Excel or CSV file')}
                </label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt"
                  disabled={importBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImportError(null); setImportResult(null);
                    try {
                      const rows = file.name.match(/\.(xlsx|xls)$/i)
                        ? await parseExcelFile(file)
                        : parseCsvText(await file.text());
                      setImportRows(rows);
                    } catch (err: any) {
                      setImportError(err?.message ?? String(err));
                    }
                  }}
                  style={{ color: 'var(--text2, #94a3b8)', fontSize: 12 }}
                />
              </div>
              <div style={{ borderTop: '1px dashed var(--border, #475569)', paddingTop: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text2, #94a3b8)', marginBottom: 6, fontWeight: 600 }}>
                  {t('Google Sheets URL')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    disabled={importBusy}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 6, direction: 'ltr',
                      border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                      color: 'var(--text, #f1f5f9)', fontSize: 12, outline: 'none',
                    }}
                  />
                  <button
                    onClick={async () => {
                      if (!sheetUrl.trim()) return;
                      setImportError(null); setImportResult(null); setImportBusy(true);
                      try {
                        const rows = await fetchGoogleSheet(sheetUrl.trim());
                        setImportRows(rows);
                      } catch (err: any) {
                        setImportError(err?.message ?? String(err));
                      } finally { setImportBusy(false); }
                    }}
                    disabled={importBusy || !sheetUrl.trim()}
                    style={{
                      background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
                      padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >{t('Fetch')}</button>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text3, #64748b)' }}>
                  {t('Sheet must be shared: Anyone with the link can view.')}
                </p>
              </div>
              {importRows.length > 0 && (
                <div style={{
                  padding: 10, borderRadius: 8, background: 'rgba(34,197,94,0.08)',
                  border: '1px solid rgba(34,197,94,0.3)', fontSize: 12, color: 'var(--text2, #94a3b8)',
                }}>
                  ✓ {t('{n} rows ready to import', { n: importRows.length })}
                </div>
              )}
              {importResult && (
                <div style={{
                  padding: 10, borderRadius: 8, background: 'rgba(34,197,94,0.12)',
                  fontSize: 13, color: '#22c55e',
                }}>
                  ✓ {t('Imported {inserted}, skipped {skipped}', { inserted: importResult.inserted, skipped: importResult.skipped })}
                </div>
              )}
              {importError && (
                <div style={{
                  padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.12)',
                  fontSize: 13, color: 'var(--danger, #ef4444)',
                }}>{importError}</div>
              )}
            </div>
            <div style={{
              padding: '14px 22px', borderTop: '1px solid var(--border, #475569)',
              display: 'flex', gap: 10, justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => { if (!importBusy) setShowImport(false); }}
                disabled={importBusy}
                style={{
                  background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                }}
              >{importResult ? t('Close') : t('Cancel')}</button>
              {!importResult && (
                <button
                  onClick={() => handleImportRows(importRows)}
                  disabled={importBusy || importRows.length === 0}
                  style={{
                    background: 'var(--success, #22c55e)', color: '#fff', border: 'none',
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: importBusy ? 'wait' : 'pointer',
                    opacity: importBusy || importRows.length === 0 ? 0.6 : 1,
                  }}
                >{importBusy ? t('Importing...') : t('Import')}</button>
              )}
            </div>
          </div>
        </div>
      )}

      <GoogleSheetsModal
        open={showGoogleSheets}
        onClose={() => setShowGoogleSheets(false)}
        resolveOrgId={resolveOrgId}
        t={t}
      />
    </div>
  );
}

// ===== Shared customer form fields with prefilled dropdowns =====
interface FormFieldsProps {
  t: (k: string, v?: any) => string;
  form: Partial<Customer>;
  setField: (k: keyof Customer, v: any) => void;
  disabled?: boolean;
}

function CustomerFormFields({ t, form, setField, disabled }: FormFieldsProps) {
  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 6,
    border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
    color: 'var(--text, #f1f5f9)', fontSize: 13, outline: 'none',
  };
  const lbl: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'var(--text2, #94a3b8)', marginBottom: 3, fontWeight: 600,
  };
  const sect: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 0.8,
    margin: '4px 0 2px', paddingBottom: 4, borderBottom: '1px solid rgba(59,130,246,0.2)',
  };
  const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
  const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };
  const communes = form.wilaya_code ? getCommunes(form.wilaya_code) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={sect}>{t('Contact')}</div>
      <div style={grid2}>
        <div>
          <label style={lbl}>{t('Name')} *</label>
          <input type="text" style={inp} value={form.name ?? ''} onChange={(e) => setField('name', e.target.value)} disabled={disabled} placeholder="John Doe" />
        </div>
        <div>
          <label style={lbl}>{t('Phone')} *</label>
          <input type="text" style={{ ...inp, direction: 'ltr' }} value={form.phone ?? ''} onChange={(e) => setField('phone', e.target.value)} disabled={disabled} placeholder="0551234567" />
        </div>
      </div>
      <div>
        <label style={lbl}>{t('Email')}</label>
        <input type="text" style={{ ...inp, direction: 'ltr' }} value={form.email ?? ''} onChange={(e) => setField('email', e.target.value)} disabled={disabled} placeholder="john@example.com" />
      </div>

      <div style={sect}>{t('Personal')}</div>
      <div style={grid3}>
        <div>
          <label style={lbl}>{t('Gender')}</label>
          <select style={inp} value={form.gender ?? ''} onChange={(e) => setField('gender', e.target.value)} disabled={disabled}>
            <option value="">—</option>
            <option value="male">{t('Male')}</option>
            <option value="female">{t('Female')}</option>
          </select>
        </div>
        <div>
          <label style={lbl}>{t('Date of Birth')}</label>
          <input type="date" style={inp} value={form.date_of_birth ?? ''} onChange={(e) => setField('date_of_birth', e.target.value)} disabled={disabled} />
        </div>
        <div>
          <label style={lbl}>{t('Blood Type')}</label>
          <select style={inp} value={form.blood_type ?? ''} onChange={(e) => setField('blood_type', e.target.value)} disabled={disabled}>
            <option value="">—</option>
            {BLOOD_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      <div style={sect}>{t('Address')}</div>
      <div style={grid2}>
        <div>
          <label style={lbl}>{t('Wilaya')}</label>
          <select style={inp} value={form.wilaya_code ?? ''} onChange={(e) => { setField('wilaya_code', e.target.value); setField('city', ''); }} disabled={disabled}>
            <option value="">—</option>
            {ALGERIA_WILAYAS.map(w => <option key={w.code} value={w.code}>{w.code} — {w.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>{t('City')}</label>
          <select style={inp} value={form.city ?? ''} onChange={(e) => setField('city', e.target.value)} disabled={disabled || !form.wilaya_code}>
            <option value="">—</option>
            {communes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={lbl}>{t('Street Address')}</label>
        <input type="text" style={inp} value={form.address ?? ''} onChange={(e) => setField('address', e.target.value)} disabled={disabled} />
      </div>

      <div style={sect}>{t('Couple File')}</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2, #94a3b8)' }}>
        <input type="checkbox" checked={!!form.is_couple} onChange={(e) => setField('is_couple', e.target.checked)} disabled={disabled} />
        {t('This is a married couple file (husband & wife in one record)')}
      </label>
      {form.is_couple && (
        <>
          <div style={grid3}>
            <div>
              <label style={lbl}>{t('Spouse Name')}</label>
              <input type="text" style={inp} value={form.spouse_name ?? ''} onChange={(e) => setField('spouse_name', e.target.value)} disabled={disabled} />
            </div>
            <div>
              <label style={lbl}>{t('Spouse Gender')}</label>
              <select style={inp} value={form.spouse_gender ?? ''} onChange={(e) => setField('spouse_gender', e.target.value)} disabled={disabled}>
                <option value="">—</option>
                <option value="male">{t('Male')}</option>
                <option value="female">{t('Female')}</option>
              </select>
            </div>
            <div>
              <label style={lbl}>{t('Spouse Blood Type')}</label>
              <select style={inp} value={form.spouse_blood_type ?? ''} onChange={(e) => setField('spouse_blood_type', e.target.value)} disabled={disabled}>
                <option value="">—</option>
                {BLOOD_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div style={grid2}>
            <div>
              <label style={lbl}>{t('Spouse Date of Birth')}</label>
              <input type="date" style={inp} value={form.spouse_dob ?? ''} onChange={(e) => setField('spouse_dob', e.target.value)} disabled={disabled} />
            </div>
            <div>
              <label style={lbl}>{t('Marriage Date')}</label>
              <input type="date" style={inp} value={form.marriage_date ?? ''} onChange={(e) => setField('marriage_date', e.target.value)} disabled={disabled} />
            </div>
          </div>
        </>
      )}

      <div style={sect}>📝 {t('Notes')}</div>
      <textarea
        value={form.notes ?? ''}
        onChange={(e) => setField('notes', e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder={t('Internal notes about this customer...')}
        style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }}
      />
    </div>
  );
}
