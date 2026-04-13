'use client';

import { useState, useTransition, useRef } from 'react';
import {
  Search,
  ChevronDown,
  ChevronUp,
  User,
  Phone,
  Mail,
  Calendar,
  Star,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Upload,
  MessageCircle,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/components/providers/locale-provider';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  importCustomers,
  importFromGoogleSheets,
  sendGroupMessage,
  getCustomersForMessaging,
  removeCustomerAlias,
  setAliasAsMainName,
} from '@/lib/actions/customer-actions';

interface Customer {
  id: string;
  organization_id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  visit_count: number;
  last_visit_at: string | null;
  created_at: string;
  previous_names?: string[] | null;
}

interface TicketHistory {
  id: string;
  ticket_number: string;
  status: string;
  created_at: string;
  serving_started_at: string | null;
  completed_at: string | null;
  service: { name: string } | null;
  department: { name: string } | null;
  feedback: { rating: number; comment: string | null }[];
}

type Modal = null | 'add' | 'edit' | 'import' | 'message';

export function CustomersClient({
  customers: initialCustomers,
}: {
  customers: Customer[];
}) {
  const { t } = useI18n();
  const { confirm: styledConfirm, alert: styledAlert } = useConfirmDialog();
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ticketHistory, setTicketHistory] = useState<Record<string, TicketHistory[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modals
  const [modal, setModal] = useState<Modal>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Import
  const [importPreview, setImportPreview] = useState<{ name: string; phone: string; email?: string }[] | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [sheetsUrl, setSheetsUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Group message
  const [messageText, setMessageText] = useState('');
  const [messageChannel, setMessageChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [messageResult, setMessageResult] = useState<{ sent: number; failed: number; error?: string } | null>(null);
  const [filterMinVisits, setFilterMinVisits] = useState('');
  const [filterLastVisitDays, setFilterLastVisitDays] = useState('');
  const [filterMatched, setFilterMatched] = useState<number | null>(null);

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      (c.name?.toLowerCase().includes(q) ?? false) ||
      (c.phone?.includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false)
    );
  });

  async function toggleExpand(customerId: string) {
    if (expandedId === customerId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(customerId);
    if (!ticketHistory[customerId]) {
      setLoadingHistory(customerId);
      const supabase = createClient();
      const { data: tickets } = await supabase
        .from('tickets')
        .select('*, service:services(name), department:departments(name), feedback(*)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20);
      setTicketHistory((prev) => ({
        ...prev,
        [customerId]: (tickets as TicketHistory[] | null) ?? [],
      }));
      setLoadingHistory(null);
    }
  }

  function formatWaitTime(ticket: TicketHistory): string {
    if (!ticket.serving_started_at) return '--';
    const waitMs =
      new Date(ticket.serving_started_at).getTime() -
      new Date(ticket.created_at).getTime();
    const mins = Math.round(waitMs / 60000);
    return t('{count} min', { count: mins });
  }

  function openAdd() {
    setEditingCustomer(null);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormError(null);
    setModal('add');
  }

  function openEdit(c: Customer) {
    setEditingCustomer(c);
    setFormName(c.name ?? '');
    setFormPhone(c.phone ?? '');
    setFormEmail(c.email ?? '');
    setFormError(null);
    setModal('edit');
  }

  function closeModal() {
    setModal(null);
    setFormError(null);
    setImportPreview(null);
    setImportResult(null);
    setMessageText('');
    setMessageResult(null);
  }

  function handleSaveCustomer() {
    if (!formName.trim() || !formPhone.trim()) {
      setFormError(t('Name and phone are required'));
      return;
    }
    startTransition(async () => {
      const result = editingCustomer
        ? await updateCustomer(editingCustomer.id, {
            name: formName,
            phone: formPhone,
            email: formEmail,
          })
        : await createCustomer({ name: formName, phone: formPhone, email: formEmail });

      if (result.error) {
        setFormError(result.error);
        return;
      }

      if (editingCustomer) {
        setCustomers((prev) => prev.map((c) => (c.id === editingCustomer.id ? { ...c, ...result.data } : c)));
      } else {
        setCustomers((prev) => [result.data as Customer, ...prev]);
      }
      closeModal();
    });
  }

  async function handleDelete(c: Customer) {
    if (!await styledConfirm(t('Delete this customer? This cannot be undone.'), { variant: 'danger', confirmLabel: 'Delete' })) return;
    startTransition(async () => {
      const result = await deleteCustomer(c.id);
      if (result.error) {
        await styledAlert(result.error);
        return;
      }
      setCustomers((prev) => prev.filter((x) => x.id !== c.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
    });
  }

  function detectColumns(headers: string[]) {
    const lower = headers.map((h) => String(h).trim().toLowerCase());
    let nameIdx = lower.findIndex((h) => h.includes('name'));
    let phoneIdx = lower.findIndex((h) => h.includes('phone') || h.includes('tel') || h.includes('mobile'));
    let emailIdx = lower.findIndex((h) => h.includes('email') || h.includes('mail'));
    if (nameIdx === -1) nameIdx = 0;
    if (phoneIdx === -1) phoneIdx = 1;
    return { nameIdx, phoneIdx, emailIdx };
  }

  function parseCsvText(text: string) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return [];
    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes('name') || firstLine.includes('phone') || firstLine.includes('email');
    const dataLines = hasHeader ? lines.slice(1) : lines;
    const headers = hasHeader ? lines[0].split(/[,;\t]/) : ['name', 'phone', 'email'];
    const { nameIdx, phoneIdx, emailIdx } = detectColumns(headers);
    return dataLines
      .map((line) => {
        const cols = line.split(/[,;\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ''));
        return {
          name: cols[nameIdx] ?? '',
          phone: cols[phoneIdx] ?? '',
          email: emailIdx >= 0 ? cols[emailIdx] ?? '' : '',
        };
      })
      .filter((r) => r.phone);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const isExcel = /\.(xlsx|xls)$/i.test(file.name);

    if (isExcel) {
      // Lazy-load SheetJS from CDN
      try {
        const w = window as any;
        if (!w.XLSX) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Excel parser'));
            document.head.appendChild(script);
          });
        }
        const XLSX = w.XLSX;
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        if (json.length === 0) return;

        const headers = json[0].map((h) => String(h ?? '').trim());
        const { nameIdx, phoneIdx, emailIdx } = detectColumns(headers);
        const rows = json.slice(1).map((row) => ({
          name: String(row[nameIdx] ?? '').trim(),
          phone: String(row[phoneIdx] ?? '').trim(),
          email: emailIdx >= 0 ? String(row[emailIdx] ?? '').trim() : '',
        })).filter((r) => r.phone);
        setImportPreview(rows);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to parse Excel file';
        await styledAlert(msg);
      }
      return;
    }

    // CSV/TSV
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '');
      setImportPreview(parseCsvText(text));
    };
    reader.readAsText(file);
  }

  function handleImportSheets() {
    if (!sheetsUrl.trim()) return;
    startTransition(async () => {
      const result = await importFromGoogleSheets(sheetsUrl.trim());
      setImportResult(result);
      const supabase = createClient();
      const { data } = await supabase
        .from('customers')
        .select('*')
        .order('last_visit_at', { ascending: false });
      if (data) setCustomers(data as Customer[]);
    });
  }

  async function applyMessageFilters() {
    const lastVisitAfter = filterLastVisitDays
      ? new Date(Date.now() - Number(filterLastVisitDays) * 86400000).toISOString()
      : undefined;
    const minVisits = filterMinVisits ? Number(filterMinVisits) : undefined;

    const result = await getCustomersForMessaging({ minVisits, lastVisitAfter });
    if (result.data) {
      setSelected(new Set(result.data.map((c) => c.id)));
      setFilterMatched(result.data.length);
    }
  }

  function handleImport() {
    if (!importPreview || importPreview.length === 0) return;
    startTransition(async () => {
      const result = await importCustomers(importPreview);
      setImportResult(result);
      // Refresh customers list
      const supabase = createClient();
      const { data } = await supabase
        .from('customers')
        .select('*')
        .order('last_visit_at', { ascending: false });
      if (data) setCustomers(data as Customer[]);
    });
  }

  function handleSendMessage() {
    if (!messageText.trim() || selected.size === 0) return;
    startTransition(async () => {
      const result = await sendGroupMessage({
        customerIds: Array.from(selected),
        message: messageText,
        channel: messageChannel,
      });
      setMessageResult(result);
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t('Customers')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('View registered customers and their visit history')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <button
              onClick={() => setModal('message')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <MessageCircle className="h-4 w-4" />
              {t('Message {count}', { count: selected.size })}
            </button>
          )}
          <button
            onClick={() => setModal('import')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Upload className="h-4 w-4" />
            {t('Import')}
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('Add Customer')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('Search by name, phone, or email...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {filtered.length > 0 && (
          <button
            onClick={toggleSelectAll}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {selected.size === filtered.length ? t('Deselect all') : t('Select all')}
          </button>
        )}
      </div>

      {/* Customers List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="hidden sm:grid sm:grid-cols-[40px_2fr_1fr_1fr_80px_120px_100px] gap-4 border-b border-border bg-muted/30 px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <div></div>
          <div>{t('Customer')}</div>
          <div>{t('Phone')}</div>
          <div>{t('Email')}</div>
          <div className="text-center">{t('Visits')}</div>
          <div className="text-right">{t('Last Visit')}</div>
          <div className="text-right">{t('Actions')}</div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            {search ? t('No customers matching your search') : t('No customers found')}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((customer) => (
              <div key={customer.id}>
                <div className="grid grid-cols-1 sm:grid-cols-[40px_2fr_1fr_1fr_80px_120px_100px] gap-2 sm:gap-4 px-6 py-4 items-center hover:bg-muted/30">
                  <div>
                    <input
                      type="checkbox"
                      checked={selected.has(customer.id)}
                      onChange={() => toggleSelect(customer.id)}
                      className="h-4 w-4 rounded border-border"
                    />
                  </div>
                  <button
                    onClick={() => toggleExpand(customer.id)}
                    className="flex items-center gap-3 text-left min-w-0"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {customer.name || t('Unnamed Customer')}
                        {Array.isArray(customer.previous_names) && customer.previous_names.length > 0 && (
                          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground" title={customer.previous_names.join(', ')}>
                            aka {customer.previous_names.length}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground sm:hidden">
                        {customer.phone || '--'}
                      </p>
                    </div>
                    {expandedId === customer.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto sm:ml-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto sm:ml-0" />
                    )}
                  </button>
                  <div className="hidden sm:block text-sm text-muted-foreground truncate">
                    {customer.phone || '--'}
                  </div>
                  <div className="hidden sm:block text-sm text-muted-foreground truncate">
                    {customer.email || '--'}
                  </div>
                  <div className="hidden sm:block text-sm text-center font-medium">
                    {customer.visit_count}
                  </div>
                  <div className="hidden sm:block text-sm text-muted-foreground text-right">
                    {customer.last_visit_at
                      ? new Date(customer.last_visit_at).toLocaleDateString()
                      : '--'}
                  </div>
                  <div className="hidden sm:flex justify-end gap-1">
                    <button
                      onClick={() => openEdit(customer)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={t('Edit')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(customer)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title={t('Delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {expandedId === customer.id && (
                  <div className="border-t border-border bg-muted/10 px-6 py-4">
                    <div className="sm:hidden mb-4 space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5" />
                        {customer.phone || '--'}
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5" />
                        {customer.email || '--'}
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        {t('{count} visits', { count: customer.visit_count })}
                      </div>
                    </div>

                    <h4 className="text-sm font-semibold mb-3">{t('Visit History')}</h4>

                    {loadingHistory === customer.id ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        {t('Loading history...')}
                      </p>
                    ) : (ticketHistory[customer.id] ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        {t('No visit history found')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(ticketHistory[customer.id] ?? []).map((ticket) => (
                          <div
                            key={ticket.id}
                            className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded shrink-0">
                                #{ticket.ticket_number}
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                                  ticket.status === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : ticket.status === 'no_show'
                                      ? 'bg-red-100 text-red-700'
                                      : ticket.status === 'cancelled'
                                        ? 'bg-gray-100 text-gray-700'
                                        : 'bg-blue-100 text-blue-700'
                                }`}
                              >
                                {t(ticket.status)}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                              {ticket.service?.name ?? ticket.department?.name ?? '--'}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                              <Clock className="h-3 w-3" />
                              {t('Wait')}: {formatWaitTime(ticket)}
                            </div>
                            <div className="text-xs text-muted-foreground shrink-0">
                              {new Date(ticket.created_at).toLocaleDateString()}{' '}
                              {new Date(ticket.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                            {ticket.feedback?.[0] && (
                              <div className="flex items-center gap-1 shrink-0">
                                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                                <span className="text-xs font-medium">
                                  {ticket.feedback[0].rating}/5
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t('Showing {filtered} of {total} customers', {
          filtered: filtered.length,
          total: customers.length,
        })}
      </p>

      {/* ── Add/Edit Modal ──────────────────────────────────────────── */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'add' ? t('Add Customer') : t('Edit Customer')} onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('Name')} *</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
              {/* Also known as — name aliases */}
              {modal === 'edit' && editingCustomer && (() => {
                const aliases: string[] = Array.isArray(editingCustomer.previous_names) ? editingCustomer.previous_names : [];
                if (aliases.length === 0) return null;
                return (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] font-semibold text-muted-foreground">{t('Also known as')}:</span>
                    {aliases.map((alias, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        <button
                          type="button"
                          title={t('Set as main name')}
                          className="hover:underline"
                          onClick={() => {
                            startTransition(async () => {
                              const result = await setAliasAsMainName(editingCustomer.id, alias);
                              if (result.data) {
                                setFormName(result.data.name);
                                setEditingCustomer({ ...editingCustomer, name: result.data.name, previous_names: result.data.previous_names });
                                setCustomers(prev => prev.map(c => c.id === editingCustomer.id
                                  ? { ...c, name: result.data!.name, previous_names: result.data!.previous_names }
                                  : c));
                              }
                            });
                          }}
                        >{alias}</button>
                        <button
                          type="button"
                          title={t('Remove alias')}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            startTransition(async () => {
                              const result = await removeCustomerAlias(editingCustomer.id, alias);
                              if (result.data) {
                                setEditingCustomer({ ...editingCustomer, previous_names: result.data });
                                setCustomers(prev => prev.map(c => c.id === editingCustomer.id
                                  ? { ...c, previous_names: result.data }
                                  : c));
                              }
                            });
                          }}
                        >×</button>
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('Phone')} *</label>
              <input
                type="tel"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('Email')}</label>
              <input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={closeModal}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={handleSaveCustomer}
                disabled={pending}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {pending ? t('Saving...') : t('Save')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Import Modal ────────────────────────────────────────────── */}
      {modal === 'import' && (
        <Modal title={t('Import Customers')} onClose={closeModal}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('Upload a CSV or Excel file with columns: name, phone, email. Or paste a Google Sheets share link.')}
            </p>

            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Upload className="h-4 w-4" />
                {t('Choose CSV or Excel file')}
              </button>
            </div>

            <div className="relative flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t('or')}</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Google Sheets URL')}</label>
              <input
                type="url"
                value={sheetsUrl}
                onChange={(e) => setSheetsUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t('Sheet must be shared as "Anyone with the link can view"')}
              </p>
              <button
                onClick={handleImportSheets}
                disabled={pending || !sheetsUrl.trim()}
                className="w-full rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {pending ? t('Importing...') : t('Import from Google Sheets')}
              </button>
            </div>

            {importPreview && importPreview.length > 0 && !importResult && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t('Preview ({count} rows)', { count: importPreview.length })}
                </p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left">{t('Name')}</th>
                        <th className="px-2 py-1 text-left">{t('Phone')}</th>
                        <th className="px-2 py-1 text-left">{t('Email')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.slice(0, 50).map((row, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2 py-1">{row.name}</td>
                          <td className="px-2 py-1">{row.phone}</td>
                          <td className="px-2 py-1">{row.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={handleImport}
                  disabled={pending}
                  className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {pending ? t('Importing...') : t('Import {count} customers', { count: importPreview.length })}
                </button>
              </div>
            )}

            {importResult && (
              <div className="rounded-lg bg-muted/30 p-4 text-sm">
                <p>✅ {t('Imported: {count}', { count: importResult.imported })}</p>
                {importResult.skipped > 0 && (
                  <p>⚠️ {t('Skipped: {count}', { count: importResult.skipped })}</p>
                )}
                {importResult.errors.length > 0 && (
                  <ul className="mt-2 text-destructive">
                    {importResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={closeModal}
                  className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {t('Done')}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Group Message Modal ─────────────────────────────────────── */}
      {modal === 'message' && (
        <Modal title={t('Send Group Message')} onClose={closeModal}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('Sending to {count} customers', { count: selected.size })}
            </p>

            <details className="rounded-lg border border-border bg-muted/20 p-3">
              <summary className="cursor-pointer text-sm font-medium">{t('Filter audience')}</summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">{t('Minimum visits')}</label>
                  <input
                    type="number"
                    min="0"
                    value={filterMinVisits}
                    onChange={(e) => setFilterMinVisits(e.target.value)}
                    placeholder="e.g. 3"
                    className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">{t('Visited within last (days)')}</label>
                  <input
                    type="number"
                    min="0"
                    value={filterLastVisitDays}
                    onChange={(e) => setFilterLastVisitDays(e.target.value)}
                    placeholder="e.g. 30"
                    className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                  />
                </div>
                <button
                  onClick={applyMessageFilters}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted"
                >
                  {t('Apply filters & select matching')}
                </button>
                {filterMatched !== null && (
                  <p className="text-xs text-muted-foreground">
                    {t('Matched {count} customers', { count: filterMatched })}
                  </p>
                )}
              </div>
            </details>

            <div>
              <label className="mb-1 block text-sm font-medium">{t('Channel')}</label>
              <select
                value={messageChannel}
                onChange={(e) => setMessageChannel(e.target.value as 'whatsapp' | 'email')}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">{t('Email')}</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">{t('Message')}</label>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder={t('Hi {name}, ...')}
                rows={5}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('Use {name} to personalize with the customer name')}
              </p>
            </div>

            {messageResult && (
              <div className="rounded-lg bg-muted/30 p-3 text-sm">
                <p>✅ {t('Sent: {count}', { count: messageResult.sent })}</p>
                {messageResult.failed > 0 && (
                  <p>❌ {t('Failed: {count}', { count: messageResult.failed })}</p>
                )}
                {messageResult.error && <p className="text-destructive">{messageResult.error}</p>}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                {t('Close')}
              </button>
              <button
                onClick={handleSendMessage}
                disabled={pending || !messageText.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {pending ? t('Sending...') : t('Send')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
