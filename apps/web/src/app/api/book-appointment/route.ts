import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { nanoid } from 'nanoid';
import { getAvailableSlots } from '@/lib/slot-generator';
import { upsertCustomerFromBooking } from '@/lib/upsert-customer';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { t as tMsg, type Locale } from '@/lib/messaging-commands';
import { checkRateLimit, publicLimiter } from '@/lib/rate-limit';
import { isValidUUID, sanitizeString, isValidDate } from '@/lib/validation';

export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, publicLimiter);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { officeId, departmentId, serviceId, customerName, customerPhone, customerEmail, scheduledAt, notes, wilaya, staffId, locale: bodyLocale } =
    body as Record<string, string | undefined>;

  if (!officeId || !departmentId || !serviceId || !customerName || !scheduledAt) {
    return NextResponse.json(
      { error: 'Missing required fields: officeId, departmentId, serviceId, customerName, scheduledAt' },
      { status: 400 }
    );
  }

  // ── Input validation ──────────────────────────────────────────
  if (!isValidUUID(officeId) || !isValidUUID(departmentId) || !isValidUUID(serviceId)) {
    return NextResponse.json({ error: 'officeId, departmentId, and serviceId must be valid UUIDs' }, { status: 400 });
  }
  if (staffId && !isValidUUID(staffId)) {
    return NextResponse.json({ error: 'staffId must be a valid UUID' }, { status: 400 });
  }
  if (!isValidDate(scheduledAt.split('T')[0])) {
    return NextResponse.json({ error: 'scheduledAt must contain a valid date (YYYY-MM-DD)' }, { status: 400 });
  }
  const cleanCustomerName = sanitizeString(customerName, 200);
  if (!cleanCustomerName) {
    return NextResponse.json({ error: 'customerName must be a non-empty string (max 200 chars)' }, { status: 400 });
  }
  const cleanCustomerPhone = customerPhone ? sanitizeString(customerPhone, 30) : undefined;
  const cleanCustomerEmail = customerEmail ? sanitizeString(customerEmail, 254) : undefined;
  const cleanNotes = notes ? sanitizeString(notes as string, 500) : undefined;
  const cleanWilaya = wilaya ? sanitizeString(wilaya as string, 100) : undefined;

  const supabase = createAdminClient();

  // Extract date and time for validation
  const scheduledDate = new Date(scheduledAt);
  const dateStr = scheduledAt.split('T')[0];
  const timeStr = `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`;

  // Check web booking is enabled
  const { data: _bookOrg } = await supabase
    .from('offices')
    .select('organization:organizations(settings)')
    .eq('id', officeId)
    .single();
  const _bookOrgSettings = ((_bookOrg as any)?.organization?.settings ?? {}) as Record<string, any>;
  if (_bookOrgSettings.web_enabled === false) {
    return NextResponse.json({ error: 'Web booking is disabled for this business' }, { status: 403 });
  }

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

  // Resolve approval gate. Default ON: bookings stay pending until provider
  // approves. Slot capacity counts pending rows so the seat stays reserved.
  const { data: officeForApproval } = await supabase
    .from('offices')
    .select('settings, organization:organizations(settings)')
    .eq('id', officeId)
    .single();
  const requireApproval = Boolean(
    (officeForApproval?.settings as any)?.require_appointment_approval ??
      ((officeForApproval as any)?.organization?.settings?.require_appointment_approval) ??
      true,
  );
  const initialStatus = requireApproval ? 'pending' : 'confirmed';

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      office_id: officeId,
      department_id: departmentId,
      service_id: serviceId,
      customer_name: cleanCustomerName,
      customer_phone: cleanCustomerPhone || null,
      customer_email: cleanCustomerEmail || null,
      scheduled_at: scheduledAt,
      status: initialStatus,
      calendar_token: calendarToken,
      notes: cleanNotes || null,
      wilaya: cleanWilaya || null,
      locale: (bodyLocale === 'ar' || bodyLocale === 'en' || bodyLocale === 'fr') ? bodyLocale : null,
      source: 'web',
      ...(staffId ? { staff_id: staffId } : {}),
    })
    .select('id, office_id, department_id, service_id, customer_name, customer_phone, customer_email, scheduled_at, status, notes, wilaya, calendar_token, staff_id')
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
        name: cleanCustomerName,
        phone: cleanCustomerPhone,
        email: cleanCustomerEmail,
        source: 'booking',
      });
    }
  } catch (e) {
    console.warn('[book-appointment] customer upsert failed:', (e as any)?.message ?? e);
  }

  // ── Customer notification (WhatsApp) ───────────────────────────
  // Web/native bookings don't go through the chat flow, so we proactively
  // send a confirmation/pending message via WhatsApp when a phone is present.
  // Messenger users always book via chat, so they get the message there.
  try {
    if (cleanCustomerPhone) {
      const { data: officeRow } = await supabase
        .from('offices')
        .select('organization:organizations(name)')
        .eq('id', officeId)
        .single();
      const orgName: string = (officeRow as any)?.organization?.name ?? '';
      const dt = new Date(scheduledAt);
      const dateLabel = dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeLabel = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      const locale: Locale = (bodyLocale === 'ar' || bodyLocale === 'en' || bodyLocale === 'fr') ? bodyLocale : 'fr';
      const templateKey = requireApproval ? 'booking_pending_approval' : 'booking_confirmed';
      const messageBody = tMsg(templateKey, locale, {
        name: orgName,
        date: dateLabel,
        time: timeLabel,
        customer: cleanCustomerName,
      });
      await sendWhatsAppMessage({ to: cleanCustomerPhone, body: messageBody });
    }
  } catch (e) {
    console.warn('[book-appointment] whatsapp notify failed:', (e as any)?.message ?? e);
  }

  return NextResponse.json({ appointment }, { status: 201 });
}
