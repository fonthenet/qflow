'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { findAppointment, checkInAppointment } from '@/lib/actions/appointment-actions';
import { PriorityBadge } from '@/components/tickets/priority-badge';

interface AppointmentCheckInProps {
  office: any;
  organization: any;
}

export function AppointmentCheckIn({ office, organization }: AppointmentCheckInProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [appointments, setAppointments] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<any>(null);

  async function handleSearch() {
    if (!searchTerm.trim()) {
      setError('Please enter your name or phone number');
      return;
    }

    setSearching(true);
    setError(null);
    setSearched(false);

    const result = await findAppointment(office.id, searchTerm.trim());

    if (result.error) {
      setError(result.error);
    } else {
      setAppointments(result.data ?? []);
      setSearched(true);
    }
    setSearching(false);
  }

  async function handleCheckIn(appointmentId: string) {
    setCheckingIn(appointmentId);
    setError(null);

    const result = await checkInAppointment(appointmentId);

    if (result.error) {
      setError(result.error);
      setCheckingIn(null);
      return;
    }

    // Redirect to the ticket QR page
    const ticket = result.data?.ticket;
    if (ticket?.qr_token) {
      router.push(`/q/${ticket.qr_token}`);
    } else {
      setSuccess(result.data);
      setCheckingIn(null);
    }
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  const officeSlug = office.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4 text-center">
        <h1 className="text-2xl font-bold">
          {organization?.name || 'QueueFlow'}
        </h1>
        <p className="text-muted-foreground">{office.name}</p>
        <p className="mt-1 text-sm text-primary font-medium">Appointment Check-In</p>
      </div>

      <div className="mx-auto max-w-md px-4 py-8">
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {success ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg
                className="h-8 w-8 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold">Checked In!</h2>
            <p className="mt-2 text-muted-foreground">
              You have been added to the queue.
            </p>
            {success.ticket && (
              <div className="mt-4 rounded-lg bg-muted p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Your Ticket</p>
                    <p className="text-3xl font-bold text-primary">
                      {success.ticket.ticket_number}
                    </p>
                  </div>
                  <PriorityBadge priorityCategory={success.ticket.priority_category} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Search form */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <h2 className="text-xl font-bold text-center mb-4">
                Find Your Appointment
              </h2>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Enter your name or phone number to look up your appointment.
              </p>

              <div className="space-y-4">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Your name or phone number"
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {searching ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                      Searching...
                    </span>
                  ) : (
                    'Search'
                  )}
                </button>
              </div>
            </div>

            {/* Results */}
            {searched && (
              <div className="mt-6 space-y-4">
                {appointments.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
                    <p className="text-muted-foreground">
                      No appointments found for today.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Please check your name/phone or book a new appointment.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium text-muted-foreground">
                      Found {appointments.length} appointment{appointments.length > 1 ? 's' : ''}:
                    </p>
                    {appointments.map((apt) => (
                      <div
                        key={apt.id}
                        className="rounded-xl border border-border bg-card p-5 shadow-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-foreground">
                              {apt.customer_name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {apt.department?.name} - {apt.service?.name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Scheduled at {formatTime(apt.scheduled_at)}
                            </p>
                          </div>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              apt.status === 'pending'
                                ? 'bg-warning/10 text-warning'
                                : 'bg-primary/10 text-primary'
                            }`}
                          >
                            {apt.status}
                          </span>
                        </div>
                        <button
                          onClick={() => handleCheckIn(apt.id)}
                          disabled={checkingIn === apt.id}
                          className="mt-4 w-full rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {checkingIn === apt.id ? (
                            <span className="flex items-center justify-center gap-2">
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                              Checking in...
                            </span>
                          ) : (
                            'Check In Now'
                          )}
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Link to book */}
            <div className="mt-6 text-center">
              <a
                href={`/book/${officeSlug}`}
                className="text-sm text-primary hover:underline"
              >
                Don&apos;t have an appointment? Book one now
              </a>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 text-center">
        <p className="text-xs text-muted-foreground">Powered by QueueFlow</p>
      </div>
    </div>
  );
}
