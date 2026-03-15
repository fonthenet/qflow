import { CalendarClock, Plus, Filter } from 'lucide-react';

export default function AppointmentsPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Appointments</h1>
          <p className="text-sm text-muted-foreground">
            Schedule and manage upcoming appointments
          </p>
        </div>
        <button
          disabled
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50 cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          New Appointment
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Today</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Week</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">No-Show Rate</p>
          <p className="mt-1 text-2xl font-bold">0%</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <CalendarClock className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">Appointment scheduling coming soon</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Allow your customers to book time slots in advance, reduce wait times, and manage your schedule efficiently.
        </p>
      </div>
    </div>
  );
}
