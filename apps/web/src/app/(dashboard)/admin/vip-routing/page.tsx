import { Crown } from 'lucide-react';

export default function VipRoutingPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">VIP Routing</h1>
        <p className="text-sm text-muted-foreground">
          Identify and fast-track high-priority visitors automatically
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">VIP Visitors Today</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg VIP Wait Time</p>
          <p className="mt-1 text-2xl font-bold">0 min</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">VIP Satisfaction</p>
          <p className="mt-1 text-2xl font-bold">N/A</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <Crown className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">VIP routing coming soon</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Automatic VIP detection, priority queue placement, dedicated service counters, and personalized greetings for high-value visitors.
        </p>
      </div>
    </div>
  );
}
