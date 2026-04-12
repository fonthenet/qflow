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

  const { officeId, departmentId, serviceId, customerName, customerPhone, customerEmail, scheduledAt, notes, wilaya, staffId, locale: bodyLocale, source: bodySource } =
    body as Record<string, string | undefined>;
  const isInHouse = bodySource === 'in_house';

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

  // Fetch org timezone + org settings in one query
  const { data: _bookOrg } = await supabase
    .from('offices')
    .select('timezone, organization:organizations(settings, timezone)')
    .eq('id', officeId)
    .single();
  // Use org-level timezone as single source of truth, fallback to office timezone
  const orgTz: string = (_bookOrg as any)?.organization?.timezone;
  const officeTzRaw: string = (_bookOrg as any)?.timezone;
  const officeTz: string = orgTz || officeTzRaw || 'Africa/Algiers';
  const _bookOrgSettings = ((_bookOrg as any)?.organization?.settings ?? {}) as Record<string, any>;

  // Normalize scheduledAt to office timezone.
  // If client sends a naive datetime (no offset, e.g. "2026-04-13T10:30:00"),
  // interpret it in the office's timezone — not UTC.
  let resolvedScheduledAt = scheduledAt;
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(scheduledAt) || scheduledAt.endsWith('Z');
  if (!hasOffset && scheduledAt.includes('T')) {
    // Compute the UTC offset for the office timezone on this date
    const naive = new Date(scheduledAt + 'Z'); // parse as UTC to get consistent date parts
    const utcFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(naive);
    const tzFmt = new Intl.DateTimeFormat('en-US', { timeZone: officeTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(naive);
    const utcMs = new Date(utcFmt).getTime();
    const tzMs = new Date(tzFmt).getTime();
    const diffMs = tzMs - utcMs;
    const sign = diffMs >= 0 ? '+' : '-';
    const absMs = Math.abs(diffMs);
    const h = String(Math.floor(absMs / 3600000)).padStart(2, '0');
    const m = String(Math.floor((absMs % 3600000) / 60000)).padStart(2, '0');
    resolvedScheduledAt = `${scheduledAt}${sign}${h}:${m}`;
  }

  // Extract date and time for validation (use the raw input time, which is in office local)
  const dateStr = scheduledAt.split('T')[0];
  const timePart = scheduledAt.split('T')[1] || '00:00';
  const timeStr = timePart.substring(0, 5); // "HH:MM"
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
  // In-house bookings are always auto-confirmed — the staff is booking on behalf of the customer
  const requireApproval = isInHouse ? false : Boolean(
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
      scheduled_at: resolvedScheduledAt,
      status: initialStatus,
      calendar_token: calendarToken,
      notes: cleanNotes || null,
      wilaya: cleanWilaya || null,
      locale: (bodyLocale === 'ar' || bodyLocale === 'en' || bodyLocale === 'fr') ? bodyLocale : null,
      source: isInHouse ? 'in_house' : 'web',
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
