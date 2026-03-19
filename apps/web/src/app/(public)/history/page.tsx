import { createClient } from '@/lib/supabase/server';

interface HistoryPageProps {
  searchParams: Promise<{ phone?: string }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const { phone } = await searchParams;
  const supabase = await createClient();

  let customer: {
    id: string;
    name: string | null;
    phone: string;
    visit_count: number;
    last_visit_at: string | null;
  } | null = null;

  let tickets: Array<{
    id: string;
    ticket_number: string;
    status: string;
    created_at: string;
    serving_started_at: string | null;
    completed_at: string | null;
    service: { name: string } | null;
    department: { name: string } | null;
    office: { name: string } | null;
    feedback: { rating: number; comment: string | null }[];
  }> = [];

  if (phone) {
    const { data: customerData } = await supabase
      .from('customers')
      .select('id, name, phone, visit_count, last_visit_at')
      .eq('phone', phone)
      .single();

    customer = customerData;

    if (customer) {
      const { data: ticketData } = await supabase
        .from('tickets')
        .select(
          '*, service:services(name), department:departments(name), office:offices(name), feedback(*)'
        )
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(50);

      tickets = (ticketData as typeof tickets) ?? [];
    }
  }

  function computeWaitMinutes(
    createdAt: string,
    servingStartedAt: string | null
  ): number | null {
    if (!servingStartedAt) return null;
    return Math.round(
      (new Date(servingStartedAt).getTime() -
        new Date(createdAt).getTime()) /
        60000
    );
  }

  // Calculate average wait time
  const waitTimes = tickets
    .map((t) => computeWaitMinutes(t.created_at, t.serving_started_at))
    .filter((w): w is number => w !== null);
  const avgWait =
    waitTimes.length > 0
      ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
      : null;

  function statusClasses(status: string): string {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'serving':
        return 'bg-blue-100 text-blue-700';
      case 'called':
        return 'bg-yellow-100 text-yellow-700';
      case 'waiting':
        return 'bg-gray-100 text-gray-700';
      case 'no_show':
        return 'bg-red-100 text-red-700';
      case 'cancelled':
        return 'bg-red-50 text-red-600';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl px-4 py-4">
          <h1 className="text-xl font-bold text-slate-900">
            Q<span className="text-blue-600">flo</span>
          </h1>
          <p className="text-sm text-slate-500">Visit History Lookup</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* Lookup Form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            Check Your Visit History
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Enter the phone number you used when checking in to see your queue
            history.
          </p>

          <form method="get" className="flex gap-3">
            <input
              type="tel"
              name="phone"
              placeholder="Enter your phone number"
              defaultValue={phone ?? ''}
              required
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
            />
            <button
              type="submit"
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Search
            </button>
          </form>
        </div>

        {/* No results */}
        {phone && !customer && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-slate-500">
              No records found for this phone number.
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Make sure you entered the same phone number used during check-in.
            </p>
          </div>
        )}

        {/* Customer found */}
        {customer && (
          <>
            {/* Summary Cards */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500 mb-1">
                  Total Visits
                </p>
                <p className="text-xl font-bold text-slate-900">
                  {customer.visit_count}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500 mb-1">
                  Avg Wait
                </p>
                <p className="text-xl font-bold text-slate-900">
                  {avgWait !== null ? `${avgWait}m` : '--'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500 mb-1">
                  Last Visit
                </p>
                <p className="text-sm font-bold text-slate-900">
                  {customer.last_visit_at
                    ? new Date(customer.last_visit_at).toLocaleDateString()
                    : '--'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500 mb-1">
                  Tickets
                </p>
                <p className="text-xl font-bold text-slate-900">
                  {tickets.length}
                </p>
              </div>
            </div>

            {/* Greeting */}
            {customer.name && (
              <p className="mt-6 text-sm text-slate-600">
                Welcome back,{' '}
                <span className="font-medium">{customer.name}</span>
              </p>
            )}

            {/* Ticket List */}
            <div className="mt-4 space-y-3">
              {tickets.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                  <p className="text-slate-500">No visit records found.</p>
                </div>
              ) : (
                tickets.map((ticket) => {
                  const waitMin = computeWaitMinutes(
                    ticket.created_at,
                    ticket.serving_started_at
                  );
                  return (
                    <div
                      key={ticket.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                              #{ticket.ticket_number}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusClasses(ticket.status)}`}
                            >
                              {ticket.status.replace('_', ' ')}
                            </span>
                            {ticket.feedback?.[0] && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-yellow-600">
                                <svg
                                  className="h-3 w-3 fill-yellow-400"
                                  viewBox="0 0 20 20"
                                >
                                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                </svg>
                                {ticket.feedback[0].rating}/5
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-sm text-slate-900">
                            {ticket.service?.name ??
                              ticket.department?.name ??
                              'General'}
                          </p>
                          {ticket.office?.name && (
                            <p className="text-xs text-slate-400">
                              {ticket.office.name}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-slate-500">
                            {new Date(ticket.created_at).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-slate-400">
                            {new Date(ticket.created_at).toLocaleTimeString(
                              [],
                              { hour: '2-digit', minute: '2-digit' }
                            )}
                          </p>
                        </div>
                      </div>
                      {waitMin !== null && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          Wait time: {waitMin} min
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
