import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { getAvailableSlots } from '@/lib/slot-generator';
import { upsertCustomerFromBooking } from '@/lib/upsert-customer';

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

  // Extract date and time for validation
  const scheduledDate = new Date(scheduledAt);
  const dateStr = scheduledAt.split('T')[0];
  const timeStr = `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`;

  // Use centralized slot generator to validate availability
  const availability = await getAvailableSlots({
    officeId,
    serviceId,
    date: dateStr,
    staffId,
  });

  // Check if booking is disabled
  if (availability.meta.booking_mode === 'disabled') {
    return NextResponse.json({ error: 'Booking is currently disabled for this business' }, { status: 403 });
  }

  // Check if office is closed or holiday
  if (availability.meta.office_closed) {
    return NextResponse.json({ error: 'Office is closed on this date' }, { status: 400 });
  }

  if (availability.meta.is_holiday) {
    return NextResponse.json({ error: 'This date is a holiday' }, { status: 400 });
  }

  // Check daily limit
  if (availability.meta.daily_limit_reached) {
    return NextResponse.json({ error: 'Daily booking limit reached for this date' }, { status: 409 });
  }

  // Check if the specific time slot is available
  const slotAvailable = availability.slots.find(s => s.time === timeStr);
  if (!slotAvailable) {
    return NextResponse.json({ error: 'This time slot is not available' }, { status: 409 });
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
    // Race protection: the partial unique index `uniq_appointments_active_slot`
    // and the `check_slot_capacity` trigger both raise SQLSTATE 23505 (unique
    // violation) when a slot has just been taken by a concurrent request.
    // Surface as 409 so clients can refresh slots and retry.
    const code = (error as any).code;
    const msg = error.message || '';
    if (
      code === '23505' ||
      msg.includes('slot_full') ||
      msg.includes('fully booked') ||
      msg.includes('uniq_appointments_active_slot')
    ) {
      return NextResponse.json(
        { error: 'slot_just_taken', message: 'This time slot was just booked by someone else. Please choose another.' },
        { status: 409 }
      );
    }
    if (msg.includes('daily_limit_reached') || msg.includes('Daily booking limit')) {
      return NextResponse.json({ error: 'daily_limit_reached', message: msg }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Auto-add / update the customer in the customers table (non-fatal on error)
  try {
    const { data: office } = await supabase
      .from('offices')
      .select('organization_id')
      .eq('id', officeId)
      .single();
    const orgId = (office as any)?.organization_id;
    if (orgId) {
      await upsertCustomerFromBooking(supabase, {
        organizationId: orgId,
        name: customerName,
        phone: customerPhone,
        email: customerEmail,
        source: 'booking',
      });
    }
  } catch (e) {
    console.warn('[book-appointment] customer upsert failed:', (e as any)?.message ?? e);
  }

  return NextResponse.json({ appointment }, { status: 201 });
}
