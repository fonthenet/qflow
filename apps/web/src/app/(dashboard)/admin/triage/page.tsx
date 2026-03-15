import { HeartPulse } from 'lucide-react';

export default function TriagePage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Triage</h1>
        <p className="text-sm text-muted-foreground">
          Prioritize patients based on urgency and condition severity
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Critical</p>
          </div>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-orange-500" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Urgent</p>
          </div>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Semi-Urgent</p>
          </div>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Standard</p>
          </div>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <HeartPulse className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">Patient triage coming soon</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Automated triage classification, urgency-based queue reordering, and real-time severity tracking for healthcare providers.
        </p>
      </div>
    </div>
  );
}
