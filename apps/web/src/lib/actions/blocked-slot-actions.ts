'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';

export async function getBlockedSlots(officeId: string, date: string) {
  const context = await getStaffContext();

  const { data, error } = await (context.supabase as any)
    .from('blocked_slots')
    .select('id, office_id, blocked_date, start_time, end_time, reason, created_by, created_at')
    .eq('office_id', officeId)
    .eq('blocked_date', date)
    .order('start_time');

  if (error) return { error: error.message };
  return { data: data ?? [] };
}

export async function getBlockedSlotsForRange(officeId: string, startDate: string, endDate: string) {
  const context = await getStaffContext();

  const { data, error } = await (context.supabase as any)
    .from('blocked_slots')
    .select('id, office_id, blocked_date, start_time, end_time, reason, created_at')
    .eq('office_id', officeId)
    .gte('blocked_date', startDate)
    .lte('blocked_date', endDate)
    .order('blocked_date')
    .order('start_time');

  if (error) return { error: error.message };
  return { data: data ?? [] };
}

export async function createBlockedSlot(data: {
  officeId: string;
  blockedDate: string;
  startTime: string;
  endTime: string;
  reason?: string;
}) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  // Verify the office belongs to this staff's organization
  const { data: office, error: officeError } = await context.supabase
    .from('offices')
    .select('id, organization_id')
    .eq('id', data.officeId)
    .single();

  if (officeError || !office) return { error: 'Office not found' };
  if (office.organization_id !== context.staff.organization_id) return { error: 'Unauthorized' };

  const { data: slot, error } = await (context.supabase as any)
    .from('blocked_slots')
    .insert({
      office_id: data.officeId,
      blocked_date: data.blockedDate,
      start_time: data.startTime,
      end_time: data.endTime,
      reason: data.reason?.trim() || null,
      created_by: context.staff.id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath('/admin/bookings');
  return { data: slot };
}

export async function deleteBlockedSlot(slotId: string) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  // Verify the blocked slot belongs to this staff's organization
  const { data: slot, error: fetchError } = await context.supabase
    .from('blocked_slots')
    .select('id, office_id, offices!inner(organization_id)')
    .eq('id', slotId)
    .single();

  if (fetchError || !slot) return { error: 'Blocked slot not found' };

  const slotOrg = (slot as any).offices?.organization_id;
  if (slotOrg !== context.staff.organization_id) return { error: 'Unauthorized' };

  const { error } = await (context.supabase as any)
    .from('blocked_slots')
    .delete()
    .eq('id', slotId);

  if (error) return { error: error.message };

  revalidatePath('/admin/bookings');
  return { success: true };
}
