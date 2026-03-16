'use client';

import { useState, useTransition } from 'react';
import { Monitor, Loader2, MapPin } from 'lucide-react';
import { assignDesk } from '@/lib/actions/ticket-actions';
import { useRouter } from 'next/navigation';

interface Desk {
  id: string;
  name: string;
  display_name: string | null;
  department_id: string;
  office_id: string;
  department: {
    id: string;
    name: string;
    code: string;
  } | null;
}

interface DeskSelectorProps {
  desks: Desk[];
  staffName: string;
}

export function DeskSelector({ desks, staffName }: DeskSelectorProps) {
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSelectDesk = (deskId: string) => {
    setSelectedDeskId(deskId);
    setError(null);
  };

  const handleConfirm = () => {
    if (!selectedDeskId) return;
    startTransition(async () => {
      const result = await assignDesk(selectedDeskId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  // Group desks by department
  const desksByDept = desks.reduce<Record<string, { deptName: string; desks: Desk[] }>>(
    (acc, desk) => {
      const deptId = desk.department_id;
      const deptName = desk.department?.name ?? 'Unknown Department';
      if (!acc[deptId]) {
        acc[deptId] = { deptName, desks: [] };
      }
      acc[deptId].desks.push(desk);
      return acc;
    },
    {}
  );

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="rounded-full bg-primary/10 p-4 inline-flex mb-4">
            <Monitor className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">
            Select Your Desk
          </h1>
          <p className="text-muted-foreground">
            Welcome, {staffName}. Choose a desk to start operating.
          </p>
        </div>

        {desks.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <MapPin className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium mb-1">No desks available</p>
            <p className="text-sm text-muted-foreground">
              All desks are currently occupied or no desks are set up for your office.
              Please contact your administrator.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(desksByDept).map(([deptId, { deptName, desks: deptDesks }]) => (
              <div key={deptId}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                  {deptName}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {deptDesks.map((desk) => (
                    <button
                      key={desk.id}
                      onClick={() => handleSelectDesk(desk.id)}
                      aria-label={`Select desk ${desk.display_name ?? desk.name} in ${desk.department?.name ?? 'Unknown Department'}`}
                      className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                        selectedDeskId === desk.id
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                          : 'border-border bg-card hover:border-primary/30 hover:bg-muted/50'
                      }`}
                    >
                      <div
                        className={`rounded-lg p-2 ${
                          selectedDeskId === desk.id
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <Monitor className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          {desk.display_name ?? desk.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {desk.department?.code ?? ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <button
              onClick={handleConfirm}
              disabled={!selectedDeskId || isPending}
              className="w-full rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Assigning...
                </span>
              ) : (
                'Start Operating'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
