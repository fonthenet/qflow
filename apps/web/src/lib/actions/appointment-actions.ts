'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  clearBookingEmailOtpCookie,
  hasVerifiedBookingEmail,
  setBookingEmailOtpCookie,
} from '@/lib/booking-email-otp';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { getOfficeDayStartIso, getOfficeDayEndIso, getDateStartIso, getDateEndIso } from '@/lib/office-day';

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
    .select('id, organization:organizations(settings)')
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
  const requireApproval = Boolean(
    (organizationSettings as any).require_appointment_approval ?? true,
  );
  const initialStatus = requireApproval ? 'pending' : 'confirmed';

  const insertData: any = {
    office_id: data.officeId,
    department_id: data.departmentId,
    service_id: data.serviceId,
    customer_name: data.customerName,
    customer_phone: data.customerPhone || null,
    customer_email: data.customerEmail || null,
    scheduled_at: data.scheduledAt,
    status: initialStatus,
    calendar_token: calendarToken,
    locale: (data.locale === 'ar' || data.locale === 'en' || data.locale === 'fr') ? data.locale : null,
    source: 'portal',
    ...(data.staffId ? { staff_id: data.staffId } : {}),
  };

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
      appointment_id: appointmentId,
      checked_in_at: new Date().toISOString(),
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

  revalidatePath('/desk');
  return { data: { appointment, ticket: { ...ticket, priority_category: priorityCategory } } };
}

export async function cancelAppointment(appointmentId: string) {
  const supabase = await createClient();

  const { data: appointment, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  // Cancel linked ticket — check both sides of the relationship:
  // 1. appointment.ticket_id (set during checkInAppointment)
  // 2. ticket.appointment_id (set when ticket is created for an appointment)
  const nowIso = new Date().toISOString();
  if (appointment?.ticket_id) {
    await supabase
      .from('tickets')
      .update({ status: 'cancelled', completed_at: nowIso })
      .eq('id', appointment.ticket_id)
      .in('status', ['waiting', 'called', 'issued']);
  }
  // Also cancel any ticket that references this appointment (covers cases
  // where appointment.ticket_id wasn't set, e.g. kiosk auto-checkin)
  await supabase
    .from('tickets')
    .update({ status: 'cancelled', completed_at: nowIso })
    .eq('appointment_id', appointmentId)
    .in('status', ['waiting', 'called', 'issued']);

  // Notify waitlist entries for the freed slot
  await notifyWaitlistOnCancellation(appointmentId);

  revalidatePath('/desk');
  return { data: appointment };
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

  // Cancel the parent (if it's still in the future) plus all children scheduled after now
  const { data: cancelled, error: cancelErr } = await (supabase as any)
    .from('appointments')
    .update({ status: 'cancelled' })
    .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
    .gte('scheduled_at', nowIso)
    .neq('status', 'cancelled')
    .select('id, ticket_id');

  if (cancelErr) {
    return { error: cancelErr.message };
  }

  // Cancel any linked tickets — check both sides of the relationship
  const ticketIds = (cancelled ?? [])
    .map((a: any) => a.ticket_id)
    .filter((id: string | null): id is string => Boolean(id));

  if (ticketIds.length > 0) {
    await (supabase as any)
      .from('tickets')
      .update({ status: 'cancelled', completed_at: nowIso })
      .in('id', ticketIds)
      .in('status', ['waiting', 'called', 'issued']);
  }

  // Also cancel tickets that reference these appointments via ticket.appointment_id
  const cancelledIds = (cancelled ?? []).map((a: any) => a.id).filter(Boolean);
  if (cancelledIds.length > 0) {
    await (supabase as any)
      .from('tickets')
      .update({ status: 'cancelled', completed_at: nowIso })
      .in('appointment_id', cancelledIds)
      .in('status', ['waiting', 'called', 'issued']);
  }

  // Notify waitlist for each freed slot
  for (const a of cancelled ?? []) {
    await notifyWaitlistOnCancellation(a.id);
  }

  revalidatePath('/admin/bookings');
  return { data: { cancelled: cancelled?.length ?? 0 } };
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
  if (appt.status === 'cancelled' || appt.status === 'completed') {
    return { error: `Cannot reschedule a ${appt.status} appointment` };
  }

  const { error: updErr } = await supabase
    .from('appointments')
    .update({ scheduled_at: newScheduledAt })
    .eq('id', appointmentId);

  if (updErr) return { error: updErr.message };

  revalidatePath('/admin/calendar');
  revalidatePath('/admin/bookings');
  return { data: { success: true } };
}

export async function getAvailableSlots(
  officeId: string,
  serviceId: string,
  date: string,
  staffId?: string,
): Promise<{
  data: string[];
  detailed?: { time: string; remaining: number; total: number }[];
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
    });

    return {
      data: result.slots.map(s => s.time),
      detailed: result.slots.map(s => ({ time: s.time, remaining: s.remaining, total: s.total })),
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

  for (let i = 1; i < count; i++) {
    const baseDate = new Date(data.scheduledAt);

    if (data.recurrenceRule === 'monthly') {
      baseDate.setMonth(baseDate.getMonth() + i);
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

export async function notifyWaitlistOnCancellation(appointmentId: string) {
  const supabase = createAdminClient();

  // Fetch the cancelled appointment details
  const { data: appointment, error: fetchError } = await supabase
    .from('appointments')
    .select('office_id, service_id, scheduled_at')
    .eq('id', appointmentId)
    .single();

  if (fetchError || !appointment) {
    return { error: fetchError?.message ?? 'Appointment not found' };
  }

  const scheduledDate = new Date(appointment.scheduled_at);
  const date = scheduledDate.toISOString().split('T')[0];
  const time = `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`;

  // Find the first waiting entry for this slot
  const { data: waitlistEntries, error: waitlistError } = await (supabase.from('slot_waitlist' as any) as any)
    .select('id')
    .eq('office_id', appointment.office_id)
    .eq('service_id', appointment.service_id)
    .eq('requested_date', date)
    .eq('requested_time', time)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(1);

  if (waitlistError || !waitlistEntries || waitlistEntries.length === 0) {
    return { data: null }; // No one on waitlist
  }

  const entryId = waitlistEntries[0].id;

  const { data: updated, error: updateError } = await (supabase.from('slot_waitlist' as any) as any)
    .update({
      status: 'notified',
      notified_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .select()
    .single();

  if (updateError) {
    return { error: updateError.message };
  }

  return { data: updated };
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
