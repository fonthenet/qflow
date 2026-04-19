import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export type AdminCaller = {
  id: string;
  role: string;
  organization_id: string;
  office_id: string | null;
  full_name: string | null;
};

export class AdminApiAuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve the calling staff member from body `caller_user_id` + `organization_id`,
 * verifying they are an active admin/manager/branch_admin in that org.
 * Throws AdminApiAuthError on failure — route handlers should catch and return
 * the appropriate NextResponse.
 */
export async function resolveAdminCaller(
  supabase: SupabaseClient<Database>,
  callerUserId: string | undefined,
  organizationId: string | undefined
): Promise<AdminCaller> {
  if (!callerUserId || !organizationId) {
    throw new AdminApiAuthError(
      'Missing required fields: caller_user_id, organization_id',
      400
    );
  }

  const { data: callerStaff, error } = await supabase
    .from('staff')
    .select('id, role, full_name, organization_id, office_id, is_active')
    .eq('auth_user_id', callerUserId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new AdminApiAuthError(`Auth lookup failed: ${error.message}`, 500);
  }

  if (!callerStaff || !['admin', 'manager', 'branch_admin'].includes(callerStaff.role)) {
    throw new AdminApiAuthError('Unauthorized: admin role required', 403);
  }

  return {
    id: callerStaff.id,
    role: callerStaff.role,
    organization_id: callerStaff.organization_id,
    office_id: callerStaff.office_id ?? null,
    full_name: callerStaff.full_name ?? null,
  };
}

export type AuditPayload = {
  action_type: string;
  entity_type: string;
  entity_id: string;
  office_id?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Direct insert into audit_logs for REST admin routes. Separate from the
 * server-action `logAuditEvent` because that requires a full StaffContext.
 */
export async function logApiAudit(
  supabase: SupabaseClient<Database>,
  caller: AdminCaller,
  payload: AuditPayload
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      organization_id: caller.organization_id,
      office_id: payload.office_id ?? null,
      actor_staff_id: caller.id,
      action_type: payload.action_type,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      summary: payload.summary ?? '',
      metadata: (payload.metadata ?? {}) as any,
    } as any);
  } catch {
    // Never fail the mutation on audit logging errors.
  }
}
