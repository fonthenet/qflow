import { Award } from 'lucide-react';

export default function LoyaltyPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Loyalty Priority</h1>
        <p className="text-sm text-muted-foreground">
          Reward repeat visitors with priority queue access and perks
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Loyalty Members</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority Uses Today</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Retention Rate</p>
          <p className="mt-1 text-2xl font-bold">0%</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <Award className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">Loyalty priority coming soon</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Tier-based loyalty programs, automatic priority upgrades for frequent visitors, visit tracking, and reward management.
        </p>
      </div>
    </div>
  );
}
