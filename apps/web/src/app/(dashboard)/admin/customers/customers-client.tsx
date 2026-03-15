'use client';

import { useState } from 'react';
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

export function CustomersClient({
  customers: initialCustomers,
}: {
  customers: Customer[];
}) {
  const t = useTerminology();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ticketHistory, setTicketHistory] = useState<
    Record<string, TicketHistory[]>
  >({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);

  const filtered = initialCustomers.filter((c) => {
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

    // Load ticket history if not already loaded
    if (!ticketHistory[customerId]) {
      setLoadingHistory(customerId);
      const supabase = createClient();
      const { data: tickets } = await supabase
        .from('tickets')
        .select(
          '*, service:services(name), department:departments(name), feedback(*)'
        )
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
    return `${mins} min`;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t.customerPlural}</h1>
        <p className="text-sm text-muted-foreground">
          View registered {t.customerPlural.toLowerCase()} and their visit history
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, phone, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Customers List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Table Header */}
        <div className="hidden sm:grid sm:grid-cols-6 gap-4 border-b border-border bg-muted/30 px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <div className="col-span-2">{t.customer}</div>
          <div>Phone</div>
          <div>Email</div>
          <div className="text-center">Visits</div>
          <div className="text-right">Last Visit</div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            {search
              ? `No ${t.customerPlural.toLowerCase()} matching your search`
              : `No ${t.customerPlural.toLowerCase()} found`}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((customer) => (
              <div key={customer.id}>
                {/* Customer Row */}
                <button
                  onClick={() => toggleExpand(customer.id)}
                  className="w-full text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 sm:gap-4 px-6 py-4 items-center">
                    <div className="col-span-2 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                        <User className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {customer.name || `Unnamed ${t.customer}`}
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
                    </div>
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
                        ? new Date(
                            customer.last_visit_at
                          ).toLocaleDateString()
                        : '--'}
                    </div>
                  </div>
                </button>

                {/* Expanded History */}
                {expandedId === customer.id && (
                  <div className="border-t border-border bg-muted/10 px-6 py-4">
                    {/* Customer details (mobile) */}
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
                        {customer.visit_count} visits
                      </div>
                    </div>

                    <h4 className="text-sm font-semibold mb-3">
                      Visit History
                    </h4>

                    {loadingHistory === customer.id ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        Loading history...
                      </p>
                    ) : (ticketHistory[customer.id] ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No visit history found
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
                                {ticket.status}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                              {ticket.service?.name ??
                                ticket.department?.name ??
                                '--'}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                              <Clock className="h-3 w-3" />
                              Wait: {formatWaitTime(ticket)}
                            </div>
                            <div className="text-xs text-muted-foreground shrink-0">
                              {new Date(
                                ticket.created_at
                              ).toLocaleDateString()}{' '}
                              {new Date(
                                ticket.created_at
                              ).toLocaleTimeString([], {
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
        Showing {filtered.length} of {initialCustomers.length} {t.customerPlural.toLowerCase()}
      </p>
    </div>
  );
}
