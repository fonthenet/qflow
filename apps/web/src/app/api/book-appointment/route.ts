import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { officeId, departmentId, serviceId, customerName, customerPhone, customerEmail, scheduledAt, notes, staffId } =
    body as Record<string, string | undefined>;

  if (!officeId || !departmentId || !serviceId || !customerName || !scheduledAt) {
    return NextResponse.json(
      { error: 'Missing required fields: officeId, departmentId, serviceId, customerName, scheduledAt' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  // Fetch org settings via office
  const { data: office, error: officeError } = await supabase
    .from('offices')
    .select('id, organization_id')
    .eq('id', officeId)
    .single();

  if (officeError || !office) {
    return NextResponse.json({ error: 'Office not found' }, { status: 404 });
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', office.organization_id)
    .single();

  const orgSettings = (org?.settings as Record<string, any> | null) ?? {};
  const bookingMode = orgSettings.booking_mode ?? 'simple';
  const bookingHorizonDays = Number(orgSettings.booking_horizon_days ?? 7);
  const slotsPerInterval = Number(orgSettings.slots_per_interval ?? 1);

  // Check if booking is disabled
  if (bookingMode === 'disabled') {
    return NextResponse.json({ error: 'Booking is currently disabled for this business' }, { status: 403 });
  }

  // Validate date is within booking horizon
  const scheduledDate = new Date(scheduledAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + bookingHorizonDays);
  maxDate.setHours(23, 59, 59, 999);
  if (scheduledDate > maxDate) {
    return NextResponse.json({ error: 'Booking date is beyond the allowed horizon' }, { status: 400 });
  }

  // Extract date and time for capacity + blocked checks
  const dateStr = scheduledAt.split('T')[0];
  const timeStr = `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`;

  // Check blocked slots (graceful — table may not exist yet)
  let isBlocked = false;
  try {
    const blockedResult = await supabase
      .from('blocked_slots')
      .select('start_time, end_time')
      .eq('office_id', officeId)
      .eq('blocked_date', dateStr);
    const blockedRanges = (blockedResult.data ?? []) as { start_time: string; end_time: string }[];
    isBlocked = blockedRanges.some((b) => timeStr >= b.start_time && timeStr < b.end_time);
  } catch {
    // Table may not exist yet
  }
  if (isBlocked) {
    return NextResponse.json({ error: 'This time slot is currently blocked' }, { status: 409 });
  }

  // Check capacity — count existing appointments at the same time slot
  const { data: slotAppointments } = await supabase
    .from('appointments')
    .select('id')
    .eq('office_id', officeId)
    .eq('service_id', serviceId)
    .neq('status', 'cancelled')
    .gte('scheduled_at', `${dateStr}T${timeStr}:00`)
    .lt('scheduled_at', `${dateStr}T${timeStr}:59`);

  if ((slotAppointments?.length ?? 0) >= slotsPerInterval) {
    return NextResponse.json({ error: 'This time slot is fully booked' }, { status: 409 });
  }

  const calendarToken = nanoid(16);

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      office_id: officeId,
      department_id: departmentId,
      service_id: serviceId,
      customer_name: customerName.trim(),
      customer_phone: customerPhone?.trim() || null,
      customer_email: customerEmail?.trim() || null,
      scheduled_at: scheduledAt,
      status: 'pending',
      calendar_token: calendarToken,
      notes: (notes as string)?.trim() || null,
      ...(staffId ? { staff_id: staffId } : {}),
    })
    .select('id, office_id, department_id, service_id, customer_name, customer_phone, customer_email, scheduled_at, status, notes, calendar_token, staff_id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ appointment }, { status: 201 });
}
