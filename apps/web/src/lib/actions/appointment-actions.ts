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

interface CreateAppointmentData {
  officeId: string;
  departmentId: string;
  serviceId: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  scheduledAt: string; // ISO string
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

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      office_id: data.officeId,
      department_id: data.departmentId,
      service_id: data.serviceId,
      customer_name: data.customerName,
      customer_phone: data.customerPhone || null,
      customer_email: data.customerEmail || null,
      scheduled_at: data.scheduledAt,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
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
    return { error: ticketError.message };
  }

  // Update appointment status and link ticket
  const { error: updateError } = await supabase
    .from('appointments')
    .update({
      status: 'checked_in',
      ticket_id: ticket.id,
    })
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

  return { data: appointment };
}

export async function getAppointmentsByDate(officeId: string, date: string) {
  const supabase = await createClient();

  // date is in YYYY-MM-DD format
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

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

export async function getAvailableSlots(
  officeId: string,
  serviceId: string,
  date: string
) {
  const supabase = createAdminClient();

  // Fetch office operating hours + org settings
  const { data: office, error: officeError } = await supabase
    .from('offices')
    .select('operating_hours, organization:organizations(settings)')
    .eq('id', officeId)
    .single();

  if (officeError || !office) {
    return { error: officeError?.message ?? 'Office not found' };
  }

  const orgSettings =
    ((office.organization as { settings?: Record<string, unknown> | null } | null)?.settings as
      | Record<string, any>
      | undefined) ?? {};

  const bookingMode = orgSettings.booking_mode ?? 'simple';
  if (bookingMode === 'disabled') return { data: [] };

  const slotDurationMinutes = Number(orgSettings.slot_duration_minutes ?? 30);
  const slotsPerInterval = Number(orgSettings.slots_per_interval ?? 1);
  const bookingHorizonDays = Number(orgSettings.booking_horizon_days ?? 7);

  // Validate date within horizon (compare date strings to avoid timezone issues)
  const todayStr = new Date().toISOString().split('T')[0];
  const maxD = new Date(todayStr + 'T12:00:00');
  maxD.setDate(maxD.getDate() + bookingHorizonDays);
  const maxDateStr = maxD.toISOString().split('T')[0];
  if (date < todayStr || date > maxDateStr) return { data: [] };

  const operatingHours = (office.operating_hours as Record<string, { open: string; close: string }>) ?? {};
  const dayOfWeek = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dayHours = operatingHours[dayOfWeek] ?? { open: '08:00', close: '17:00' };
  const allSlots = generateSlots(dayHours.open, dayHours.close, slotDurationMinutes);

  // Fetch existing appointments
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  const appointmentsResult = await supabase
    .from('appointments')
    .select('scheduled_at')
    .eq('office_id', officeId)
    .eq('service_id', serviceId)
    .neq('status', 'cancelled')
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay);

  // Fetch blocked slots (graceful — table may not exist yet)
  let blockedData: { start_time: string; end_time: string }[] = [];
  try {
    const blockedResult = await (supabase as any)
      .from('blocked_slots')
      .select('start_time, end_time')
      .eq('office_id', officeId)
      .eq('blocked_date', date);
    blockedData = (blockedResult.data ?? []) as { start_time: string; end_time: string }[];
  } catch {
    // Table may not exist yet
  }

  // Count bookings per slot time
  const slotBookingCounts = new Map<string, number>();
  for (const a of appointmentsResult.data ?? []) {
    const d = new Date(a.scheduled_at);
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    slotBookingCounts.set(t, (slotBookingCounts.get(t) ?? 0) + 1);
  }

  const now = new Date();
  const isToday = date === todayStr;

  const availableSlots = allSlots.filter((slot) => {
    if ((slotBookingCounts.get(slot) ?? 0) >= slotsPerInterval) return false;
    if (blockedData.some((b) => slot >= b.start_time && slot < b.end_time)) return false;
    if (isToday) {
      const slotTime = new Date(`${date}T${slot}:00`);
      if (slotTime <= now) return false;
    }
    return true;
  });

  return { data: availableSlots };
}

function generateSlots(openTime: string, closeTime: string, durationMinutes: number): string[] {
  const slots: string[] = [];
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);

  let currentH = openH;
  let currentM = openM;

  while (currentH < closeH || (currentH === closeH && currentM < closeM)) {
    slots.push(
      `${String(currentH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`
    );
    currentM += durationMinutes;
    if (currentM >= 60) {
      currentH += Math.floor(currentM / 60);
      currentM = currentM % 60;
    }
  }

  return slots;
}

export async function findAppointment(officeId: string, searchTerm: string): Promise<{ data: any[]; error?: string }> {
  const supabase = createAdminClient();

  const today = new Date().toISOString().split('T')[0];
  const startOfDay = `${today}T00:00:00`;
  const endOfDay = `${today}T23:59:59`;

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
