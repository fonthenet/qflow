'use client';

import { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Mail,
  Phone,
  Search,
  Star,
  User,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useTerminology } from '@/lib/terminology-context';

interface Customer {
  id: string;
  organization_id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  visit_count: number;
  last_visit_at: string | null;
  created_at: string;
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

const statusClasses: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700',
  no_show: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-600',
  serving: 'bg-sky-50 text-sky-700',
  called: 'bg-amber-50 text-amber-700',
  waiting: 'bg-[#f8efe1] text-[#946200]',
};

export function CustomersClient({
  customers: initialCustomers,
}: {
  customers: Customer[];
}) {
  const t = useTerminology();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ticketHistory, setTicketHistory] = useState<Record<string, TicketHistory[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return initialCustomers.filter((customer) => {
      if (!query) return true;
      return (
        (customer.name?.toLowerCase().includes(query) ?? false) ||
        (customer.phone?.includes(query) ?? false) ||
        (customer.email?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [initialCustomers, search]);

  const repeatCustomers = initialCustomers.filter((customer) => customer.visit_count > 1).length;
  const reachableCustomers = initialCustomers.filter((customer) => customer.phone || customer.email).length;

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
    return `${Math.round(waitMs / 60000)} min`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Command center support</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{t.customerPlural}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              See every returning guest, client, patient, or visitor with enough context to route them back into live operations quickly.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label={`Total ${t.customerPlural.toLowerCase()}`} value={initialCustomers.length.toString()} helper="Profiles in this workspace" />
            <MetricCard label="Repeat visits" value={repeatCustomers.toString()} helper="Customers with 2 or more visits" />
            <MetricCard label="Reachable" value={reachableCustomers.toString()} helper="Phone or email on file" />
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={`Search ${t.customerPlural.toLowerCase()} by name, phone, or email`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#10292f] focus:ring-2 focus:ring-[#10292f]/10"
          />
        </div>
      </section>

      <section className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-16 text-center shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
            <Users className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-4 text-base font-semibold text-slate-900">
              {search ? `No ${t.customerPlural.toLowerCase()} match this search.` : `No ${t.customerPlural.toLowerCase()} yet.`}
            </p>
            <p className="mt-2 text-sm text-slate-500">Profiles will appear here as visits are created and customers return.</p>
          </div>
        ) : (
          filtered.map((customer) => (
            <article
              key={customer.id}
              className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.04)]"
            >
              <button type="button" onClick={() => toggleExpand(customer.id)} className="w-full text-left">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f6f7f4] text-slate-700">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-slate-950">
                        {customer.name || `Unnamed ${t.customer}`}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {customer.phone || 'No phone'}
                        {customer.email ? ` · ${customer.email}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      {customer.visit_count} visits
                    </span>
                    <span className="text-sm text-slate-500">
                      Last visit {customer.last_visit_at ? new Date(customer.last_visit_at).toLocaleDateString() : '—'}
                    </span>
                    {expandedId === customer.id ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </div>
                </div>
              </button>

              {expandedId === customer.id ? (
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <InfoCard icon={Phone} label="Phone" value={customer.phone || 'Not provided'} />
                    <InfoCard icon={Mail} label="Email" value={customer.email || 'Not provided'} />
                    <InfoCard
                      icon={Calendar}
                      label="Created"
                      value={new Date(customer.created_at).toLocaleDateString()}
                    />
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Visit history</p>
                        <p className="mt-1 text-sm text-slate-500">Most recent 20 visits and outcomes.</p>
                      </div>
                    </div>

                    {loadingHistory === customer.id ? (
                      <p className="py-8 text-center text-sm text-slate-500">Loading visit history...</p>
                    ) : (ticketHistory[customer.id] ?? []).length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500">No visit history found.</p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {(ticketHistory[customer.id] ?? []).map((ticket) => (
                          <div
                            key={ticket.id}
                            className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4"
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-sm font-semibold text-slate-900">
                                    #{ticket.ticket_number}
                                  </span>
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                      statusClasses[ticket.status] || 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {ticket.status.replace('_', ' ')}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm text-slate-700">
                                  {ticket.service?.name ?? ticket.department?.name ?? 'Unassigned service'}
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                                <span className="inline-flex items-center gap-1.5">
                                  <Clock className="h-3.5 w-3.5" />
                                  Wait {formatWaitTime(ticket)}
                                </span>
                                <span>
                                  {new Date(ticket.created_at).toLocaleDateString()}{' '}
                                  {new Date(ticket.created_at).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                {ticket.feedback?.[0] ? (
                                  <span className="inline-flex items-center gap-1.5 text-slate-700">
                                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                    {ticket.feedback[0].rating}/5
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>

      <p className="text-sm text-slate-500">
        Showing {filtered.length} of {initialCustomers.length} {t.customerPlural.toLowerCase()}.
      </p>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-400" />
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      </div>
      <p className="mt-3 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
