'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MapPin, Users, Clock } from 'lucide-react';

interface BranchComparisonProps {
  organization: any;
  offices: any[];
}

export function BranchComparison({ organization, offices: initialOffices }: BranchComparisonProps) {
  const [offices, setOffices] = useState(initialOffices);

  // Real-time refresh every 30 seconds
  useEffect(() => {
    const refreshStats = async () => {
      const supabase = createClient();
      const updated = await Promise.all(
        initialOffices.map(async (office) => {
          const { count: waitingCount } = await supabase
            .from('tickets')
            .select('*', { count: 'exact', head: true })
            .eq('office_id', office.id)
            .eq('status', 'waiting');

          const { count: servingCount } = await supabase
            .from('tickets')
            .select('*', { count: 'exact', head: true })
            .eq('office_id', office.id)
            .in('status', ['called', 'serving']);

          return {
            ...office,
            waitingCount: waitingCount || 0,
            servingCount: servingCount || 0,
          };
        })
      );
      setOffices(updated);
    };

    const interval = setInterval(refreshStats, 30000);
    return () => clearInterval(interval);
  }, [initialOffices]);

  // Sort by least busy
  const sorted = [...offices].sort((a, b) => a.waitingCount - b.waitingCount);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">{organization.name}</h1>
          <p className="mt-2 text-muted-foreground">
            Compare wait times across branches
          </p>
        </div>

        <div className="space-y-4">
          {sorted.map((office, index) => {
            const estimatedWait = office.waitingCount * 8; // rough estimate

            return (
              <div
                key={office.id}
                className={`rounded-xl border bg-card p-6 shadow-sm transition-all ${
                  index === 0
                    ? 'border-success/50 ring-2 ring-success/20'
                    : 'border-border'
                }`}
              >
                {index === 0 && (
                  <div className="mb-3 inline-block rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
                    Shortest wait
                  </div>
                )}

                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">{office.name}</h3>
                    {office.address && (
                      <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {office.address}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-2xl font-bold">
                        {office.waitingCount}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">in queue</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-6 text-sm">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>
                      {estimatedWait === 0
                        ? 'No wait'
                        : `~${estimatedWait} min wait`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        office.servingCount > 0
                          ? 'bg-success animate-pulse'
                          : 'bg-gray-300'
                      }`}
                    />
                    <span>
                      {office.servingCount} desk
                      {office.servingCount !== 1 ? 's' : ''} active
                    </span>
                  </div>
                </div>

                {/* Queue density bar */}
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      office.waitingCount === 0
                        ? 'bg-success'
                        : office.waitingCount < 5
                          ? 'bg-success'
                          : office.waitingCount < 15
                            ? 'bg-warning'
                            : 'bg-destructive'
                    }`}
                    style={{
                      width: `${Math.min(
                        (office.waitingCount / Math.max(...offices.map((o) => o.waitingCount), 1)) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Data refreshes automatically every 30 seconds
        </p>
      </div>
    </div>
  );
}
