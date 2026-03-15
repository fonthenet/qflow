import { DoorOpen } from 'lucide-react';

export default function RoomAssignmentPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Room Assignment</h1>
        <p className="text-sm text-muted-foreground">
          Assign and manage rooms, suites, and resource allocation
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Rooms</p>
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
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Housekeeping</p>
          <p className="mt-1 text-2xl font-bold text-yellow-600">0</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <DoorOpen className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">Room assignment coming soon</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Real-time room availability, automatic assignment based on preferences, housekeeping status integration, and occupancy tracking.
        </p>
      </div>
    </div>
  );
}
