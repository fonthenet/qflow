import { BellRing } from 'lucide-react';

export default function ConciergePage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Concierge Queue</h1>
        <p className="text-sm text-muted-foreground">
          Manage concierge requests and guest service queues
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Requests</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg Response Time</p>
          <p className="mt-1 text-2xl font-bold">0 min</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed Today</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <BellRing className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">Concierge queue coming soon</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Guest request management, service routing, priority handling for VIP guests, and real-time staff coordination.
        </p>
      </div>
    </div>
  );
}
