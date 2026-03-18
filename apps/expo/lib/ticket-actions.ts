import { supabase } from './supabase';

// ── Call Next Ticket ─────────────────────────────────────────────
export async function callNextTicket(deskId: string, staffId: string) {
  const { data, error } = await supabase.rpc('call_next_ticket', {
    p_desk_id: deskId,
    p_staff_id: staffId,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ── Call Specific Ticket ──────────────────────────────────────────
export async function callSpecificTicket(ticketId: string, deskId: string, staffId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'called',
      desk_id: deskId,
      called_by_staff_id: staffId,
      called_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Start Serving ─────────────────────────────────────────────────
export async function startServing(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'serving',
      serving_started_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Mark Served ───────────────────────────────────────────────────
export async function markServed(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'served',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Mark No-Show ──────────────────────────────────────────────────
export async function markNoShow(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'no_show',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Cancel Ticket ─────────────────────────────────────────────────
export async function cancelTicket(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Recall (re-notify customer) ───────────────────────────────────
export async function recallTicket(ticketId: string) {
  const { data: ticket } = await supabase
    .from('tickets')
    .select('recall_count')
    .eq('id', ticketId)
    .single();

  const { error } = await supabase
    .from('tickets')
    .update({
      called_at: new Date().toISOString(),
      recall_count: (ticket?.recall_count ?? 0) + 1,
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Reset to Queue (send back to waiting) ─────────────────────────
export async function resetToQueue(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: null,
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Park Ticket (put on hold) ─────────────────────────────────────
export async function parkTicket(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({ parked_at: new Date().toISOString() })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Unpark Ticket (resume from hold) ──────────────────────────────
export async function unparkTicket(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({ parked_at: null })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Transfer Ticket ───────────────────────────────────────────────
export async function transferTicket(
  ticketId: string,
  targetDepartmentId: string,
  targetServiceId: string,
) {
  // Get original ticket
  const { data: original, error: fetchErr } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (fetchErr || !original) throw new Error('Ticket not found');

  // Generate new ticket number
  const { data: newNumber, error: rpcErr } = await supabase.rpc('generate_daily_ticket_number', {
    p_department_id: targetDepartmentId,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  // Create transferred ticket
  const { error: insertErr } = await supabase.from('tickets').insert({
    office_id: original.office_id,
    department_id: targetDepartmentId,
    service_id: targetServiceId,
    ticket_number: newNumber,
    status: 'waiting',
    priority: original.priority,
    priority_category_id: original.priority_category_id,
    customer_data: original.customer_data,
    customer_id: original.customer_id,
    is_remote: original.is_remote,
    transferred_from_ticket_id: ticketId,
    qr_token: original.qr_token,
    checked_in_at: new Date().toISOString(),
  });
  if (insertErr) throw new Error(insertErr.message);

  // Mark original as transferred
  const { error: updateErr } = await supabase.from('tickets').update({
    status: 'served',
    completed_at: new Date().toISOString(),
    notes: `Transferred to department`,
  }).eq('id', ticketId);
  if (updateErr) throw new Error(updateErr.message);
}

// ── CRUD: Staff ───────────────────────────────────────────────────
export async function createStaff(data: {
  email: string;
  password: string;
  full_name: string;
  role: string;
  organization_id: string;
  office_id?: string | null;
  department_id?: string | null;
}) {
  if (!data.password || data.password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  // Get current user ID for authorization
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://qflow-sigma.vercel.app';
  const res = await fetch(`${BASE_URL}/api/create-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: data.email,
      password: data.password,
      full_name: data.full_name,
      role: data.role,
      organization_id: data.organization_id,
      office_id: data.office_id || null,
      department_id: data.department_id || null,
      caller_user_id: user.id,
    }),
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Failed to create staff');

  return result;
}

export async function updateStaff(staffId: string, data: {
  full_name?: string;
  role?: string;
  office_id?: string | null;
  department_id?: string | null;
  is_active?: boolean;
}) {
  const { error } = await supabase.from('staff').update(data).eq('id', staffId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Desks ───────────────────────────────────────────────────
export async function createDesk(data: {
  name: string;
  office_id: string;
  department_id?: string | null;
}) {
  const { error } = await supabase.from('desks').insert({
    name: data.name,
    office_id: data.office_id,
    department_id: data.department_id || null,
    is_active: true,
    status: 'closed',
  });
  if (error) throw new Error(error.message);
}

export async function updateDesk(deskId: string, data: {
  name?: string;
  department_id?: string | null;
  is_active?: boolean;
  status?: string;
}) {
  const { error } = await supabase.from('desks').update(data).eq('id', deskId);
  if (error) throw new Error(error.message);
}

export async function deleteDesk(deskId: string) {
  const { error } = await supabase.from('desks').delete().eq('id', deskId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Offices ─────────────────────────────────────────────────
export async function createOffice(data: {
  name: string;
  organization_id: string;
  address?: string;
  timezone?: string;
}) {
  const { error } = await supabase.from('offices').insert({
    name: data.name,
    organization_id: data.organization_id,
    address: data.address || null,
    timezone: data.timezone || null,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function updateOffice(officeId: string, data: {
  name?: string;
  address?: string | null;
  timezone?: string | null;
  is_active?: boolean;
}) {
  const { error } = await supabase.from('offices').update(data).eq('id', officeId);
  if (error) throw new Error(error.message);
}

export async function deleteOffice(officeId: string) {
  const { error } = await supabase.from('offices').delete().eq('id', officeId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Departments ─────────────────────────────────────────────
export async function createDepartment(data: {
  name: string;
  code: string;
  office_id: string;
}) {
  const { error } = await supabase.from('departments').insert({
    name: data.name,
    code: data.code,
    office_id: data.office_id,
  });
  if (error) throw new Error(error.message);
}

export async function updateDepartment(deptId: string, data: { name?: string; code?: string }) {
  const { error } = await supabase.from('departments').update(data).eq('id', deptId);
  if (error) throw new Error(error.message);
}

export async function deleteDepartment(deptId: string) {
  const { error } = await supabase.from('departments').delete().eq('id', deptId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Services ────────────────────────────────────────────────
export async function createService(data: {
  name: string;
  code: string;
  department_id: string;
  office_id: string;
}) {
  const { error } = await supabase.from('services').insert({
    name: data.name,
    code: data.code,
    department_id: data.department_id,
    office_id: data.office_id,
  });
  if (error) throw new Error(error.message);
}

export async function updateService(serviceId: string, data: { name?: string; code?: string }) {
  const { error } = await supabase.from('services').update(data).eq('id', serviceId);
  if (error) throw new Error(error.message);
}

export async function deleteService(serviceId: string) {
  const { error } = await supabase.from('services').delete().eq('id', serviceId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Priority Categories ─────────────────────────────────────
export async function createPriority(data: {
  name: string;
  organization_id: string;
  icon?: string;
  color?: string;
  weight?: number;
}) {
  const { error } = await supabase.from('priority_categories').insert({
    name: data.name,
    organization_id: data.organization_id,
    icon: data.icon || null,
    color: data.color || null,
    weight: data.weight ?? 1,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function updatePriority(priorityId: string, data: {
  name?: string;
  icon?: string | null;
  color?: string | null;
  weight?: number;
  is_active?: boolean;
}) {
  const { error } = await supabase.from('priority_categories').update(data).eq('id', priorityId);
  if (error) throw new Error(error.message);
}

export async function deletePriority(priorityId: string) {
  const { error } = await supabase.from('priority_categories').delete().eq('id', priorityId);
  if (error) throw new Error(error.message);
}

// ── Bookings / Appointments ───────────────────────────────────────
export async function fetchAppointments(officeIds: string[], status?: string) {
  let query = supabase
    .from('appointments')
    .select('*')
    .in('office_id', officeIds)
    .order('scheduled_at', { ascending: true });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function checkInAppointment(appointmentId: string, officeId: string, departmentId: string, serviceId: string) {
  // Get appointment
  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (apptErr || !appt) throw new Error('Appointment not found');

  // Generate ticket number
  const { data: ticketNumber, error: rpcErr } = await supabase.rpc('generate_daily_ticket_number', {
    p_department_id: departmentId,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  // Create ticket from appointment
  const { data: ticket, error: ticketErr } = await supabase.from('tickets').insert({
    office_id: officeId,
    department_id: departmentId,
    service_id: serviceId,
    ticket_number: ticketNumber,
    status: 'waiting',
    customer_data: {
      name: appt.customer_name,
      phone: appt.customer_phone,
      email: appt.customer_email,
    },
    appointment_id: appointmentId,
    checked_in_at: new Date().toISOString(),
  }).select('id').single();
  if (ticketErr) throw new Error(ticketErr.message);

  // Update appointment status
  await supabase.from('appointments').update({
    status: 'checked_in',
    ticket_id: ticket.id,
  }).eq('id', appointmentId);

  return ticket;
}

export async function cancelAppointment(appointmentId: string) {
  const { error } = await supabase.from('appointments').update({
    status: 'cancelled',
  }).eq('id', appointmentId);
  if (error) throw new Error(error.message);
}

// ── Virtual Codes ─────────────────────────────────────────────────
export async function fetchVirtualCodes(orgId: string) {
  const { data, error } = await supabase
    .from('virtual_queue_codes')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createVirtualCode(data: {
  organization_id: string;
  office_id?: string | null;
  department_id?: string | null;
  service_id?: string | null;
}) {
  const { error } = await supabase.from('virtual_queue_codes').insert({
    organization_id: data.organization_id,
    office_id: data.office_id || null,
    department_id: data.department_id || null,
    service_id: data.service_id || null,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function toggleVirtualCode(codeId: string, isActive: boolean) {
  const { error } = await supabase.from('virtual_queue_codes').update({ is_active: isActive }).eq('id', codeId);
  if (error) throw new Error(error.message);
}

export async function deleteVirtualCode(codeId: string) {
  const { error } = await supabase.from('virtual_queue_codes').delete().eq('id', codeId);
  if (error) throw new Error(error.message);
}
