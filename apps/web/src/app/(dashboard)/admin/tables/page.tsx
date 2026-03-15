import { LayoutGrid, Plus } from 'lucide-react';

export default function TablesPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Table Management</h1>
          <p className="text-sm text-muted-foreground">
            Manage table layout, availability, and seating assignments
          </p>
        </div>
        <button
          disabled
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50 cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          Add Table
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Tables</p>
          <p className="mt-1 text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available</p>
          <p className="mt-1 text-2xl font-bold text-green-600">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Occupied</p>
          <p className="mt-1 text-2xl font-bold text-orange-600">0</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reserved</p>
          <p className="mt-1 text-2xl font-bold text-blue-600">0</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <LayoutGrid className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">Table management coming soon</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Visual floor plan, table status tracking, party size matching, and automatic table assignment for walk-ins and reservations.
        </p>
      </div>
    </div>
  );
}
