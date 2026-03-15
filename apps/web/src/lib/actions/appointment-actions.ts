'use server';

import { createClient } from '@/lib/supabase/server';
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
  const supabase = await createClient();

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

  return { data: appointment };
}

export async function checkInAppointment(appointmentId: string) {
  const supabase = await createClient();

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

  revalidatePath('/admin/queue');
  return { data: { appointment, ticket } };
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
  const supabase = await createClient();

  // Fetch office operating hours
  const { data: office, error: officeError } = await supabase
    .from('offices')
    .select('operating_hours')
    .eq('id', officeId)
    .single();

  if (officeError || !office) {
    return { error: officeError?.message ?? 'Office not found' };
  }

  // Parse operating hours - expected format: { "monday": { "open": "08:00", "close": "17:00" }, ... }
  const operatingHours = (office.operating_hours as Record<string, { open: string; close: string }>) ?? {};
  const dayOfWeek = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dayHours = operatingHours[dayOfWeek];

  if (!dayHours) {
    // Fallback: default hours 08:00-17:00
    return { data: generateSlots('08:00', '17:00', date) };
  }

  const allSlots = generateSlots(dayHours.open, dayHours.close, date);

  // Fetch existing appointments for that date to exclude booked slots
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  const { data: existingAppointments } = await supabase
    .from('appointments')
    .select('scheduled_at')
    .eq('office_id', officeId)
    .eq('service_id', serviceId)
    .neq('status', 'cancelled')
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay);

  const bookedTimes = new Set(
    (existingAppointments ?? []).map((a) => {
      const d = new Date(a.scheduled_at);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    })
  );

  // Filter out slots that are in the past (if date is today)
  const now = new Date();
  const isToday = date === now.toISOString().split('T')[0];

  const availableSlots = allSlots.filter((slot) => {
    if (bookedTimes.has(slot)) return false;
    if (isToday) {
      const [h, m] = slot.split(':').map(Number);
      const slotTime = new Date(date + 'T12:00:00');
      slotTime.setHours(h, m, 0, 0);
      if (slotTime <= now) return false;
    }
    return true;
  });

  return { data: availableSlots };
}

function generateSlots(openTime: string, closeTime: string, date: string): string[] {
  const slots: string[] = [];
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);

  let currentH = openH;
  let currentM = openM;

  while (currentH < closeH || (currentH === closeH && currentM < closeM)) {
    slots.push(
      `${String(currentH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`
    );
    currentM += 30;
    if (currentM >= 60) {
      currentM -= 60;
      currentH += 1;
    }
  }

  return slots;
}

export async function findAppointment(officeId: string, searchTerm: string): Promise<{ data: any[]; error?: string }> {
  const supabase = await createClient();

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
