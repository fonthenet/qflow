import { getStaffContext, type StaffContext } from '@/lib/authz';

interface AuditPayload {
  actionType: string;
  entityType: string;
  entityId?: string | null;
  officeId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

export async function logAuditEvent(
  context: StaffContext,
  payload: AuditPayload
) {
  await context.supabase.from('audit_logs').insert({
    organization_id: context.staff.organization_id,
    office_id: payload.officeId ?? null,
    actor_staff_id: context.staff.id,
    action_type: payload.actionType,
    entity_type: payload.entityType,
    entity_id: payload.entityId ?? null,
    summary: payload.summary,
    metadata: payload.metadata ?? {},
  });
}

export async function logAuditForCurrentStaff(payload: AuditPayload) {
  const context = await getStaffContext();
  await logAuditEvent(context, payload);
}
