'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertBookingAllowed, BookingGuardError } from '@/lib/booking-guard';
import {
  clearBookingEmailOtpCookie,
  hasVerifiedBookingEmail,
  setBookingEmailOtpCookie,
} from '@/lib/booking-email-otp';
import { nanoid } from 'nanoid';
import { normalizeWilayaDisplay } from '@/lib/wilayas';
import { revalidatePath } from 'next/cache';
import { getOfficeDayStartIso, getOfficeDayEndIso, getDateStartIso, getDateEndIso } from '@/lib/office-day';
import { transitionAppointment, notifyAppointmentRescheduled } from '@/lib/lifecycle';
import { trackUrl } from '@/lib/config';
import { isCustomerAutoApprove } from '@/lib/customer-auto-approve';

interface CreateAppointmentData {
  officeId: string;
  departmentId: string;
  serviceId: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  scheduledAt: string; // ISO string
  staffId?: string;
  locale?: string;
  notes?: string;
  wilaya?: string;
  partySize?: number;
}

interface CreateRecurringAppointmentsData extends CreateAppointmentData {
  recurrenceRule: 'weekly' | 'biweekly' | 'monthly';
  recurrenceCount: number; // max 12
}

interface JoinSlotWaitlistData {
  officeId: string;
  serviceId: string;
  date: string;
  time: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
}

export async function createAppointment(data: CreateAppointmentData) {
  const supabase = createAdminClient();

  const { data: office, error: officeError } = await supabase
    .from('offices')
    .select('id, organization_id, organization:organizations(id, settings)')
    .eq('id', data.officeId)
    .single();

  if (officeError || !office) {
    return { error: officeError?.message ?? 'Office not found' };
  }

  const organizationSettings =
    ((office.organization as { settings?: Record<string, unknown> | null } | null)?.settings as
      | Record<string, unknown>
      | undefined) ?? {};
  const emailOtpEnabled = Boolean(organizationSettings.email_otp_enabled);
  const emailOtpRequiredForBooking = Boolean(
    organizationSettings.email_otp_required_for_booking
  );

  if (emailOtpEnabled && emailOtpRequiredForBooking) {
    const customerEmail = data.customerEmail?.trim().toLowerCase();

    if (!customerEmail) {
      return { error: 'Email verification is required before booking this visit.' };
    }

    const verified = await hasVerifiedBookingEmail({
      email: customerEmail,
      officeId: data.officeId,
    });

    if (!verified) {
      return { error: 'Please verify your email before confirming this booking.' };
    }
  }

  const calendarToken = nanoid(16);

  // Approval gate. Default ON: bookings stay pending until provider approves.
  let requireApproval = Boolean(
    (organizationSettings as any).require_appointment_approval ?? true,
  );
  // Per-customer override: customers flagged `auto_approve_reservations` skip
  // the approval gate. Matching on (organization_id, phone). Best-effort.
  if (requireApproval && data.customerPhone) {
    const orgIdForLookup: string | null =
      ((office as any)?.organization_id as string) ||
      ((office as any)?.organization?.id as string) ||
      null;
    if (orgIdForLookup) {
      const trusted = await isCustomerAutoApprove(
        supabase,
        orgIdForLookup,
        data.customerPhone,
        null,
      );
      if (trusted) requireApproval = false;
    }
  }
  const initialStatus = requireApproval ? 'pending' : 'confirmed';

  // Normalize scheduledAt: if naive (no offset/Z), interpret in the org timezone
  let resolvedScheduledAt = data.scheduledAt;
  try {
    const { toTimezoneAware } = await import('@/lib/timezone');
    const { data: officeForTz } = await supabase
      .from('offices')
      .select('organization:organizations(timezone)')
      .eq('id', data.officeId)
      .single();
    const tz: string = (officeForTz as any)?.organization?.timezone || 'Africa/Algiers';
    resolvedScheduledAt = toTimezoneAware(data.scheduledAt, tz);
  } catch { /* fallback to naive */ }

  const insertData: any = {
    office_id: data.officeId,
    department_id: data.departmentId,
    service_id: data.serviceId,
    customer_name: data.customerName,
    customer_phone: data.customerPhone || null,
    customer_email: data.customerEmail || null,
    scheduled_at: resolvedScheduledAt,
    status: initialStatus,
    calendar_token: calendarToken,
    locale: (data.locale === 'ar' || data.locale === 'en' || data.locale === 'fr') ? data.locale : null,
    source: 'portal',
    notes: data.notes || null,
    wilaya: normalizeWilayaDisplay(data.wilaya) || null,
    ...(data.staffId ? { staff_id: data.staffId } : {}),
    ...(typeof data.partySize === 'number' && data.partySize > 0 ? { party_size: data.partySize } : {}),
  };

  // Centralized booking gate — same rules as web/WhatsApp/Messenger paths.
  // Admin UI is treated as in-house: staff can override office_closed/holiday/
  // slot-level checks to rescue walk-ins, but booking_mode=disabled and
  // always_closed still hard-block.
  try {
    await assertBookingAllowed({
      officeId: data.officeId,
      serviceId: data.serviceId,
      scheduledAt: data.scheduledAt,
      staffId: data.staffId,
      isInHouse: true,
    });
  } catch (err) {
    if (err instanceof BookingGuardError) {
      return { error: err.message };
    }
    throw err;
  }

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    // Race protection: unique-index/trigger raises 23505 when slot is taken.
    const code = (error as any).code;
    const msg = error.message || '';
    if (code === '23505' || msg.includes('slot_full') || msg.includes('uniq_appointments_active_slot') || msg.includes('fully booked')) {
      return { error: 'This time slot was just booked by someone else. Please choose another.' };
    }
    return { error: msg };
  }

  await clearBookingEmailOtpCookie();

  return { data: appointment };
}

export async function markBookingEmailOtpVerified(data: {
  email: string;
  officeId: string;
  expiresInMinutes: number;
}) {
  await setBookingEmailOtpCookie({
    email: data.email,
    officeId: data.officeId,
    expiresInMinutes: data.expiresInMinutes,
  });

  return { success: true };
}

export async function clearBookingEmailOtpVerification() {
  await clearBookingEmailOtpCookie();
  return { success: true };
}

interface UpdateAppointmentContactData {
  appointmentId: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
}

export async function updateAppointmentContact(data: UpdateAppointmentContactData) {
  const supabase = createAdminClient();

  const { data: appointment, error: fetchError } = await supabase
    .from('appointments')
    .select('id, office_id, status')
    .eq('id', data.appointmentId)
    .single();

  if (fetchError || !appointment) {
    return { error: fetchError?.message ?? 'Appointment not found' };
  }

  if (appointment.status === 'cancelled') {
    return { error: 'Cancelled appointments can no longer be updated' };
  }

  const { data: updated, error } = await supabase
    .from('appointments')
    .update({
      customer_name: data.customerName.trim(),
      customer_phone: data.customerPhone?.trim() || null,
      customer_email: data.customerEmail?.trim() || null,
    })
    .eq('id', data.appointmentId)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/admin/bookings');
  revalidatePath('/desk');

  return { data: updated };
}

export async function checkInAppointment(appointmentId: string) {
  const supabase = createAdminClient();

  // Fetch the appointment
  const { data: appointment, error: fetchError } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (fetchError || !appointment) {
    return { error: fetchError?.message ?? 'Appointment not found' };
  }

  if (appointment.status === 'checked_in') {
    return { error: 'Appointment is already checked in' };
  }

  if (appointment.status === 'cancelled') {
    return { error: 'Appointment has been cancelled' };
  }

  // Generate ticket number
  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: appointment.department_id }
  );

  if (seqError || !seqData || seqData.length === 0) {
    return { error: seqError?.message ?? 'Failed to generate ticket number' };
  }

  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);

  // Estimate wait time
  const { data: waitMinutes } = await supabase.rpc('estimate_wait_time', {
    p_department_id: appointment.department_id,
    p_service_id: appointment.service_id,
  });

  // Create ticket with higher priority (5) for appointments
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .insert({
      office_id: appointment.office_id,
      department_id: appointment.department_id,
      service_id: appointment.service_id,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status: 'waiting',
      priority: 5,
      source: 'appointment',
      locale: (appointment as any).locale ?? null,
      appointment_id: appointmentId,
      checked_in_at: new Date().toISOString(),
      notes: (appointment as any).notes || null,
      customer_data: {
        name: appointment.customer_name,
        phone: appointment.customer_phone,
        email: appointment.customer_email,
      },
      estimated_wait_minutes: waitMinutes ?? null,
    })
    .select()
    .single();

  if (ticketError) {
    // Unique index violation = duplicate check-in race condition
    if (ticketError.code === '23505' && ticketError.message?.includes('appointment')) {
      return { error: 'Appointment is already checked in' };
    }
    return { error: ticketError.message };
  }

  // Update appointment status and link ticket
  const checkinUpdate: any = {
    status: 'checked_in',
    ticket_id: ticket.id,
  };
  const { error: updateError } = await supabase
    .from('appointments')
    .update(checkinUpdate)
    .eq('id', appointmentId);

  if (updateError) {
    return { error: updateError.message };
  }

  let priorityCategory = null;
  if (ticket.priority_category_id) {
    const { data } = await supabase
      .from('priority_categories')
      .select('id, name, icon, color')
      .eq('id', ticket.priority_category_id)
      .single();
    priorityCategory = data ?? null;
  }

  // ── Upsert customer record (dedup by phone, track name aliases) ──
  if (appointment.customer_phone) {
    try {
      const { upsertCustomerFromBooking } = await import('@/lib/upsert-customer');
      const { data: officeForUpsert } = await supabase
        .from('offices')
        .select('organization_id, organization:organizations(timezone)')
        .eq('id', appointment.office_id)
        .single();
      const upsertOrgId = (officeForUpsert as any)?.organization_id;
      const upsertTz = (officeForUpsert as any)?.organization?.timezone ?? 'Africa/Algiers';
      if (upsertOrgId) {
        await upsertCustomerFromBooking(supabase, {
          organizationId: upsertOrgId,
          name: appointment.customer_name,
          phone: appointment.customer_phone,
          email: appointment.customer_email,
          wilayaCode: (appointment as any).wilaya,
          source: 'appointment',
          timezone: upsertTz,
        });
      }
    } catch (e) {
      console.warn('[checkInAppointment] customer upsert failed (non-fatal):', e);
    }
  }

  // ── Send "joined" WhatsApp notification (same as desktop/kiosk path) ──
  if (appointment.customer_phone) {
    try {
      const { data: office } = await supabase
        .from('offices')
        .select('name, organization:organizations(timezone)')
        .eq('id', appointment.office_id)
        .single();

      // Use org-level timezone as single source of truth
      const checkinOrgTz: string = (office as any)?.organization?.timezone || 'Africa/Algiers';
      const { resolveDialCode } = await import('@qflo/shared');
      const countryDialCode = resolveDialCode(checkinOrgTz) ?? undefined;

      // Count waiting tickets ahead for queue position
      const { count: aheadCount } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('department_id', appointment.department_id)
        .eq('status', 'waiting')
        .lt('created_at', ticket.created_at);
      const position = (aheadCount ?? 0) + 1;

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        const tUrl = trackUrl(qrToken);
        await fetch(`${supabaseUrl}/functions/v1/notify-ticket`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            ticketId: ticket.id,
            event: 'joined',
            phone: appointment.customer_phone,
            ticketNumber: ticket_num,
            officeName: office?.name ?? '',
            position,
            trackUrl: tUrl,
            waitMinutes: waitMinutes ?? 1,
            countryDialCode,
            locale: (appointment as any).locale ?? 'fr',
          }),
        });
      }
    } catch (err) {
      console.error('[checkInAppointment] Failed to send joined notification:', err);
    }
  }

  revalidatePath('/desk');
  return { data: { appointment, ticket: { ...ticket, priority_category: priorityCategory } } };
}

export async function cancelAppointment(appointmentId: string) {
  const result = await transitionAppointment(appointmentId, 'cancelled');

  if (!result.ok) {
    return { error: result.notifyError ?? 'Failed to cancel appointment' };
  }

  revalidatePath('/desk');
  revalidatePath('/admin/bookings');
  return { data: { id: appointmentId, status: 'cancelled' } };
}

/**
 * Permanently delete an appointment.
 * Hard-deletes from the database — the slot becomes immediately available.
 * Also deletes any linked ticket that hasn't been served yet.
 * No customer notification is sent.
 */
export async function deleteAppointment(appointmentId: string) {
  const supabase = createAdminClient();

  // Fetch the appointment to check it exists
  const { data: appt, error: fetchErr } = await (supabase as any)
    .from('appointments')
    .select('id, status, ticket_id')
    .eq('id', appointmentId)
    .single();

  if (fetchErr || !appt) {
    return { error: 'Appointment not found' };
  }

  // If there's a linked ticket that hasn't been served, delete it too
  if (appt.ticket_id) {
    await (supabase as any)
      .from('tickets')
      .delete()
      .eq('id', appt.ticket_id)
      .not('status', 'eq', 'served');
  }

  // Also clean up any tickets that reference this appointment by appointment_id
  await (supabase as any)
    .from('tickets')
    .delete()
    .eq('appointment_id', appointmentId)
    .not('status', 'eq', 'served');

  // Hard-delete the appointment
  const { error: deleteErr } = await (supabase as any)
    .from('appointments')
    .delete()
    .eq('id', appointmentId);

  if (deleteErr) {
    return { error: 'Failed to delete appointment: ' + deleteErr.message };
  }

  revalidatePath('/desk');
  revalidatePath('/admin/bookings');
  return { data: { id: appointmentId, deleted: true } };
}

/**
 * Cancel an entire recurring series.
 * Cancels the parent appointment and all future child instances.
 * Past instances (already happened) are left alone.
 */
export async function cancelRecurringSeries(appointmentId: string) {
  const supabase = createAdminClient();

  // Find the appointment and determine the series root
  const { data: appt, error: apptErr } = await (supabase as any)
    .from('appointments')
    .select('id, recurrence_parent_id')
    .eq('id', appointmentId)
    .single();

  if (apptErr || !appt) {
    return { error: apptErr?.message ?? 'Appointment not found' };
  }

  const parentId = appt.recurrence_parent_id ?? appt.id;
  const nowIso = new Date().toISOString();

  // Find all future appointments in the series (don't update yet — let lifecycle handle each)
  const { data: toCancel, error: findErr } = await (supabase as any)
    .from('appointments')
    .select('id')
    .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
    .gte('scheduled_at', nowIso)
    .neq('status', 'cancelled');

  if (findErr) {
    return { error: findErr.message };
  }

  // Cancel each through the lifecycle (handles tickets + notify + waitlist)
  let count = 0;
  for (const a of toCancel ?? []) {
    const result = await transitionAppointment(a.id, 'cancelled');
    if (result.ok) count++;
  }

  revalidatePath('/admin/bookings');
  return { data: { cancelled: count } };
}

export async function getAppointmentsByDate(officeId: string, date: string) {
  const supabase = await createClient();

  // Fetch office timezone for correct date boundaries
  const { data: officeRow } = await supabase
    .from('offices')
    .select('timezone')
    .eq('id', officeId)
    .single();
  const tz = officeRow?.timezone ?? undefined;

  // date is in YYYY-MM-DD format
  const startOfDay = getDateStartIso(date, tz);
  const endOfDay = getDateEndIso(date, tz);

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('*, service:services(name, estimated_service_time), department:departments(name)')
    .eq('office_id', officeId)
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay)
    .order('scheduled_at');

  if (error) {
    return { error: error.message };
  }

  return { data: appointments ?? [] };
}

/**
 * Fetch appointments within a date range for calendar view.
 * Returns appointments with joined service/department/staff data.
 */
export async function getAppointmentsForRange(
  officeId: string,
  startIso: string,
  endIso: string,
  filters?: { departmentId?: string; serviceId?: string; staffId?: string; excludeCancelled?: boolean },
) {
  const supabase = await createClient();

  let query = supabase
    .from('appointments')
    .select(`
      id, office_id, department_id, service_id, staff_id,
      customer_name, customer_phone, customer_email,
      scheduled_at, status, notes, wilaya, ticket_id,
      locale, reminder_sent,
      recurrence_rule, recurrence_parent_id, calendar_token,
      created_at,
      service:services(name, color, estimated_service_time),
      department:departments(name, code),
      staff:staff(full_name)
    `)
    .eq('office_id', officeId)
    .gte('scheduled_at', startIso)
    .lte('scheduled_at', endIso)
    .order('scheduled_at', { ascending: true })
    .limit(1000);

  if (filters?.excludeCancelled !== false) {
    query = query.not('status', 'in', '(cancelled,declined)');
  }
  if (filters?.departmentId) {
    query = query.eq('department_id', filters.departmentId);
  }
  if (filters?.serviceId) {
    query = query.eq('service_id', filters.serviceId);
  }
  if (filters?.staffId) {
    query = query.eq('staff_id', filters.staffId);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return { data: data ?? [] };
}

/**
 * Reschedule an appointment to a new time.
 */
export async function rescheduleAppointment(appointmentId: string, newScheduledAt: string) {
  const supabase = await createClient();

  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, status, office_id')
    .eq('id', appointmentId)
    .single();

  if (fetchErr || !appt) return { error: 'Appointment not found' };
  if (['cancelled', 'completed', 'no_show', 'declined'].includes(appt.status)) {
    return { error: `Cannot reschedule a ${appt.status} appointment` };
  }

  // Optimistic lock: only update if status hasn't changed since read (prevents concurrent reschedule)
  const { error: updErr, count: updCount } = await (supabase as any)
    .from('appointments')
    .update({ scheduled_at: newScheduledAt }, { count: 'exact' })
    .eq('id', appointmentId)
    .eq('status', appt.status);

  if (updErr) return { error: updErr.message };
  if (updCount === 0) return { error: 'Appointment was modified by another user. Please refresh and try again.' };

  // Notify customer about the reschedule (fire-and-forget — don't block the UI)
  notifyAppointmentRescheduled(appointmentId, newScheduledAt).catch((err) => {
    console.error('[reschedule] notification error:', err);
  });

  revalidatePath('/admin/calendar');
  revalidatePath('/admin/bookings');
  return { data: { success: true } };
}

export async function getAvailableSlots(
  officeId: string,
  serviceId: string,
  date: string,
  staffId?: string,
  partySize?: number,
): Promise<{
  data: string[];
  detailed?: { time: string; remaining: number; total: number; available: boolean; reason?: 'taken' | 'daily_limit' }[];
  meta?: Record<string, unknown>;
  error?: string;
}> {
  try {
    const { getAvailableSlots: generateSlots } = await import('@/lib/slot-generator');

    const result = await generateSlots({
      officeId,
      serviceId,
      date,
      staffId,
      partySize,
    });

    // `data` (legacy consumers) stays available-only so nothing books a
    // taken slot by accident. `detailed` carries the full day including
    // taken slots + the `available` flag for richer UIs.
    const bookable = result.slots.filter(s => s.available !== false);
    return {
      data: bookable.map(s => s.time),
      detailed: result.slots.map(s => ({
        time: s.time,
        remaining: s.remaining,
        total: s.total,
        available: s.available !== false,
        reason: s.reason,
      })),
      meta: result.meta as unknown as Record<string, unknown>,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load available slots';
    return { data: [], error: message };
  }
}

export async function findAppointment(officeId: string, searchTerm: string): Promise<{ data: any[]; error?: string }> {
  const supabase = createAdminClient();

  // Fetch office timezone for correct date boundaries
  const { data: officeRow } = await supabase
    .from('offices')
    .select('timezone')
    .eq('id', officeId)
    .single();
  const tz = officeRow?.timezone ?? undefined;

  const startOfDay = getOfficeDayStartIso(tz);
  const endOfDay = getOfficeDayEndIso(tz);

  // Search by name or phone
  let query = supabase
    .from('appointments')
    .select('*, service:services(name), department:departments(name)')
    .eq('office_id', officeId)
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay)
    .in('status', ['pending', 'confirmed']);

  // Try to match by name (case insensitive) or phone
  const { data: byName } = await supabase
    .from('appointments')
    .select('*, service:services(name), department:departments(name)')
    .eq('office_id', officeId)
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay)
    .in('status', ['pending', 'confirmed'])
    .ilike('customer_name', `%${searchTerm}%`);

  const { data: byPhone } = await supabase
    .from('appointments')
    .select('*, service:services(name), department:departments(name)')
    .eq('office_id', officeId)
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay)
    .in('status', ['pending', 'confirmed'])
    .ilike('customer_phone', `%${searchTerm}%`);

  // Combine and deduplicate
  const all = [...(byName ?? []), ...(byPhone ?? [])];
  const unique = Array.from(new Map(all.map((a) => [a.id, a])).values());

  return { data: unique };
}

export async function createRecurringAppointments(data: CreateRecurringAppointmentsData) {
  const supabase = createAdminClient();

  const count = Math.min(Math.max(1, data.recurrenceCount), 12);

  // Create the parent appointment first
  const parentResult = await createAppointment(data);
  if (parentResult.error || !parentResult.data) {
    return { error: parentResult.error ?? 'Failed to create parent appointment' };
  }

  const parentAppointment = parentResult.data;
  const appointments = [parentAppointment];

  // Calculate interval in days
  const intervalDays =
    data.recurrenceRule === 'weekly' ? 7 :
    data.recurrenceRule === 'biweekly' ? 14 :
    0; // monthly handled separately

  const originalDay = new Date(data.scheduledAt).getDate();

  for (let i = 1; i < count; i++) {
    const baseDate = new Date(data.scheduledAt);

    if (data.recurrenceRule === 'monthly') {
      baseDate.setMonth(baseDate.getMonth() + i);
      // Fix day-of-month overflow: e.g., Jan 31 → setMonth(1) gives Mar 3 (Feb overflow)
      // Clamp to the last day of the target month if the original day overflowed
      if (baseDate.getDate() !== originalDay) {
        baseDate.setDate(0); // Sets to last day of previous month (the intended target month)
      }
    } else {
      baseDate.setDate(baseDate.getDate() + intervalDays * i);
    }

    const calendarToken = nanoid(16);

    const recurringInsertData: any = {
      office_id: data.officeId,
      department_id: data.departmentId,
      service_id: data.serviceId,
      customer_name: data.customerName,
      customer_phone: data.customerPhone || null,
      customer_email: data.customerEmail || null,
      scheduled_at: baseDate.toISOString(),
      // Mirror the parent appointment's status (already approval-gated above).
      status: parentAppointment.status ?? 'pending',
      calendar_token: calendarToken,
      recurrence_parent_id: parentAppointment.id,
      ...(data.staffId ? { staff_id: data.staffId } : {}),
      ...(typeof data.partySize === 'number' && data.partySize > 0 ? { party_size: data.partySize } : {}),
    };

    const { data: recurring, error } = await supabase
      .from('appointments')
      .insert(recurringInsertData)
      .select()
      .single();

    if (error) {
      // Return what we've created so far along with the error
      return { data: appointments, error: `Failed to create instance ${i + 1}: ${error.message}` };
    }

    appointments.push(recurring);
  }

  return { data: appointments };
}

export async function joinSlotWaitlist(data: JoinSlotWaitlistData) {
  const supabase = createAdminClient();

  if (!data.officeId || !data.serviceId || !data.date || !data.time || !data.customerName) {
    return { error: 'Missing required fields: officeId, serviceId, date, time, customerName' };
  }

  const { data: entry, error } = await (supabase.from('slot_waitlist' as any) as any)
    .insert({
      office_id: data.officeId,
      service_id: data.serviceId,
      requested_date: data.date,
      requested_time: data.time,
      customer_name: data.customerName.trim(),
      customer_phone: data.customerPhone?.trim() || null,
      customer_email: data.customerEmail?.trim() || null,
      status: 'waiting',
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data: entry };
}

export async function getCalendarEvent(calendarToken: string) {
  const supabase = createAdminClient();

  const { data: appointment, error } = await (supabase
    .from('appointments')
    .select(
      `*,
       service:services(name, estimated_service_time),
       department:departments(name),
       office:offices(name, organization:organizations(name))`
    ) as any)
    .eq('calendar_token', calendarToken)
    .single();

  if (error || !appointment) {
    return { error: error?.message ?? 'Appointment not found' };
  }

  return { data: appointment };
}

// ── Timeline / Activity Log ──

export interface TimelineEvent {
  time: string;
  label: string;
  eventType: string;
  color: string;
  source?: string | null;
}

export async function getAppointmentTimeline(appointmentId: string): Promise<{ data: TimelineEvent[] }> {
  const supabase = await createClient();

  // Fetch appointment to get ticket_id and created_at
  const { data: appt } = await supabase
    .from('appointments')
    .select('id, ticket_id, status, created_at, updated_at')
    .eq('id', appointmentId)
    .single();

  if (!appt) return { data: [] };

  const events: TimelineEvent[] = [];

  // Always add creation event
  events.push({ time: appt.created_at!, eventType: 'created', label: 'Appointment created', color: '#3b82f6' });

  const eventLabels: Record<string, { label: string; color: string }> = {
    joined: { label: 'Joined queue', color: '#8b5cf6' },
    checked_in: { label: 'Checked in', color: '#22c55e' },
    called: { label: 'Called to desk', color: '#f59e0b' },
    recalled: { label: 'Recalled', color: '#f59e0b' },
    serving_started: { label: 'Service started', color: '#06b6d4' },
    served: { label: 'Served', color: '#22c55e' },
    completed: { label: 'Completed', color: '#22c55e' },
    no_show: { label: 'No show', color: '#ef4444' },
    cancelled: { label: 'Cancelled', color: '#ef4444' },
    transferred: { label: 'Transferred', color: '#8b5cf6' },
    buzzed: { label: 'Buzzed', color: '#f59e0b' },
    returned_to_queue: { label: 'Returned to queue', color: '#64748b' },
    parked: { label: 'Parked', color: '#64748b' },
    resumed: { label: 'Resumed', color: '#3b82f6' },
  };

  // If linked ticket, fetch ticket_events + ticket timestamps
  if (appt.ticket_id) {
    const [{ data: ticketEvents }, { data: ticket }] = await Promise.all([
      supabase
        .from('ticket_events')
        .select('event_type, from_status, to_status, created_at, source')
        .eq('ticket_id', appt.ticket_id)
        .order('created_at', { ascending: true }),
      supabase
        .from('tickets')
        .select('created_at, called_at, checked_in_at, serving_started_at, completed_at, parked_at, status')
        .eq('id', appt.ticket_id)
        .single(),
    ]);

    if (ticketEvents && ticketEvents.length > 0) {
      // Use event-based log
      for (const ev of ticketEvents) {
        const info = eventLabels[ev.event_type] ?? { label: ev.event_type, color: '#64748b' };
        events.push({ time: ev.created_at!, eventType: ev.event_type, label: info.label, color: info.color, source: ev.source });
      }
    } else if (ticket) {
      // Fallback: reconstruct from ticket timestamp columns
      if (ticket.created_at) events.push({ time: ticket.created_at, eventType: 'joined', label: 'Joined queue', color: '#8b5cf6' });
      if (ticket.checked_in_at) events.push({ time: ticket.checked_in_at, eventType: 'checked_in', label: 'Checked in', color: '#22c55e' });
      if (ticket.called_at) events.push({ time: ticket.called_at, eventType: 'called', label: 'Called to desk', color: '#f59e0b' });
      if (ticket.serving_started_at) events.push({ time: ticket.serving_started_at, eventType: 'serving_started', label: 'Service started', color: '#06b6d4' });
      if (ticket.completed_at) {
        const termLabel = ticket.status === 'no_show' ? 'No show' : ticket.status === 'cancelled' ? 'Cancelled' : 'Completed';
        const termColor = ticket.status === 'no_show' || ticket.status === 'cancelled' ? '#ef4444' : '#22c55e';
        events.push({ time: ticket.completed_at, eventType: ticket.status ?? 'completed', label: termLabel, color: termColor });
      }
    }
  } else {
    // No linked ticket — derive from appointment status
    if (['confirmed'].includes(appt.status)) {
      events.push({ time: appt.updated_at ?? appt.created_at!, eventType: 'confirmed', label: 'Confirmed', color: '#22c55e' });
    }
    if (['checked_in', 'serving', 'completed', 'no_show'].includes(appt.status)) {
      events.push({ time: appt.updated_at ?? appt.created_at!, eventType: 'checked_in', label: 'Checked in', color: '#22c55e' });
    }
    if (appt.status === 'completed') {
      events.push({ time: appt.updated_at ?? appt.created_at!, eventType: 'completed', label: 'Completed', color: '#22c55e' });
    }
    if (appt.status === 'cancelled') {
      events.push({ time: appt.updated_at ?? appt.created_at!, eventType: 'cancelled', label: 'Cancelled', color: '#ef4444' });
    }
    if (appt.status === 'no_show') {
      events.push({ time: appt.updated_at ?? appt.created_at!, eventType: 'no_show', label: 'No show', color: '#ef4444' });
    }
    if (appt.status === 'declined') {
      events.push({ time: appt.updated_at ?? appt.created_at!, eventType: 'declined', label: 'Declined', color: '#ef4444' });
    }
  }

  events.sort((x, y) => new Date(x.time).getTime() - new Date(y.time).getTime());
  return { data: events };
}
