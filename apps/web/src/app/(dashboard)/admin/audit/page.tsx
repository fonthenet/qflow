import { redirect } from 'next/navigation';
import { getStaffContext, isOrganizationWideRole, requireAuditAccess } from '@/lib/authz';

function formatMetadata(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const serialized = JSON.stringify(value);
  return serialized.length > 220 ? `${serialized.slice(0, 220)}...` : serialized;
}

export default async function AuditPage() {
  const context = await getStaffContext();
  try {
    requireAuditAccess(context);
  } catch {
    redirect('/desk');
  }

  let query = context.supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  query = isOrganizationWideRole(context.staff.role)
    ? query.eq('organization_id', context.staff.organization_id)
    : query.in('office_id', context.accessibleOfficeIds);

  const { data: auditLogs, error } = await query;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load audit logs: {error.message}</p>
      </div>
    );
  }

  const officeIds = Array.from(
    new Set((auditLogs ?? []).map((entry) => entry.office_id).filter(Boolean) as string[])
  );
  const actorIds = Array.from(
    new Set((auditLogs ?? []).map((entry) => entry.actor_staff_id).filter(Boolean) as string[])
  );

  const [{ data: offices }, { data: actors }] = await Promise.all([
    officeIds.length > 0
      ? context.supabase.from('offices').select('id, name').in('id', officeIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    actorIds.length > 0
      ? context.supabase.from('staff').select('id, full_name').in('id', actorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const officeMap = new Map((offices ?? []).map((office) => [office.id, office.name]));
  const actorMap = new Map((actors ?? []).map((actor) => [actor.id, actor.full_name]));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Audit Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Latest governance and queue-control actions across your accessible scope.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scope
          </p>
          <p className="text-sm font-medium text-foreground">
            {isOrganizationWideRole(context.staff.role)
              ? 'Organization-wide'
              : `${context.accessibleOfficeIds.length} office${context.accessibleOfficeIds.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[1.3fr_0.9fr_0.9fr_0.8fr_0.8fr] gap-4 border-b border-border px-6 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Summary</div>
          <div>Action</div>
          <div>Actor</div>
          <div>Office</div>
          <div>When</div>
        </div>

        {auditLogs && auditLogs.length > 0 ? (
          <div className="divide-y divide-border">
            {auditLogs.map((entry) => (
              <div key={entry.id} className="grid grid-cols-[1.3fr_0.9fr_0.9fr_0.8fr_0.8fr] gap-4 px-6 py-4 text-sm">
                <div>
                  <p className="font-medium text-foreground">{entry.summary}</p>
                  {formatMetadata(entry.metadata) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatMetadata(entry.metadata)}
                    </p>
                  )}
                </div>
                <div className="text-muted-foreground">
                  <p className="font-medium text-foreground">{entry.action_type}</p>
                  <p className="text-xs">{entry.entity_type}</p>
                </div>
                <div className="text-muted-foreground">
                  {entry.actor_staff_id ? actorMap.get(entry.actor_staff_id) ?? 'Unknown staff' : 'System'}
                </div>
                <div className="text-muted-foreground">
                  {entry.office_id ? officeMap.get(entry.office_id) ?? 'Unknown office' : 'Organization'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">No audit events yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              New template, settings, desk, and queue-control actions will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
