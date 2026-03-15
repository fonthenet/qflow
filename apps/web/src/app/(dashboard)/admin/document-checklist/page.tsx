import { FileCheck, Plus } from 'lucide-react';

export default function DocumentChecklistPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Document Checklist</h1>
          <p className="text-sm text-muted-foreground">
            Define required documents per service to ensure visitors come prepared
          </p>
        </div>
        <button
          disabled
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50 cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          Add Checklist
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Checklists</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Incomplete Visits</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Compliance Rate</p>
          <p className="mt-1 text-2xl font-bold">0%</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <FileCheck className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">Document checklists coming soon</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Define required documents per service type, notify visitors before their visit, and verify document completion at check-in.
        </p>
      </div>
    </div>
  );
}
