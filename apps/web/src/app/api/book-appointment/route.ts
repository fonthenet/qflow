import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { nanoid } from 'nanoid';
import { checkBookingAllowed } from '@/lib/booking-guard';
import { upsertCustomerFromBooking } from '@/lib/upsert-customer';
import { isCustomerAutoApprove } from '@/lib/customer-auto-approve';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { t as tMsg, type Locale } from '@/lib/messaging-commands';
import { checkRateLimit, publicLimiter } from '@/lib/rate-limit';
import { isValidUUID, sanitizeString, isValidDate } from '@/lib/validation';
import { toTimezoneAware } from '@/lib/timezone';
import { normalizeWilayaDisplay } from '@/lib/wilayas';

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
  const bodyPartySize = (body as { partySize?: number | string })?.partySize;
  const isInHouse = bodySource === 'in_house';
  // Resolve the channel tag that gets stored on the row. Whitelist known
  // values so e.g. the mobile app can claim its own 'mobile_app' badge.
  const APPT_ALLOWED_SOURCES = new Set(['in_house', 'mobile_app', 'portal', 'qr_code', 'web']);
  const resolvedSource =
    typeof bodySource === 'string' && APPT_ALLOWED_SOURCES.has(bodySource) ? bodySource : 'web';

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
  const cleanWilaya = wilaya ? normalizeWilayaDisplay(sanitizeString(wilaya as string, 100)) ?? undefined : undefined;

  // party_size is only used by restaurant-category orgs; for others it stays null.
  const partySizeNum = typeof bodyPartySize === 'number'
    ? bodyPartySize
    : typeof bodyPartySize === 'string' && bodyPartySize.trim() !== ''
      ? Number(bodyPartySize)
      : undefined;
  const cleanPartySize =
    typeof partySizeNum === 'number' && Number.isFinite(partySizeNum) && partySizeNum >= 1 && partySizeNum <= 50
      ? Math.floor(partySizeNum)
      : undefined;

  const supabase = createAdminClient();

  // Fetch org timezone + org settings in one query
  const { data: _bookOrg } = await supabase
    .from('offices')
    .select('timezone, organization_id, organization:organizations(id, settings, timezone)')
    .eq('id', officeId)
    .single();
  // Use org-level timezone as single source of truth, fallback to office timezone
  const orgTz: string = (_bookOrg as any)?.organization?.timezone;
  const officeTzRaw: string = (_bookOrg as any)?.timezone;
  const officeTz: string = orgTz || officeTzRaw || 'Africa/Algiers';
  const _bookOrgSettings = ((_bookOrg as any)?.organization?.settings ?? {}) as Record<string, any>;
  const _bookOrgId: string | null =
    ((_bookOrg as any)?.organization_id as string) ||
    ((_bookOrg as any)?.organization?.id as string) ||
    null;

  // Normalize scheduledAt to office timezone (converts naive datetime to timezone-aware)
  const resolvedScheduledAt = toTimezoneAware(scheduledAt, officeTz);

  if (_bookOrgSettings.web_enabled === false) {
    return NextResponse.json({ error: 'Web booking is disabled for this business' }, { status: 403 });
  }

  // Centralized booking gate — same rules as WhatsApp/Messenger/admin paths.
  // Honors booking_mode=disabled, always_closed, office_closed, holidays,
  // daily limits, and slot availability. In-house bookings can override
  // office_closed/holiday/slot-level checks (walk-in rescue).
  const guard = await checkBookingAllowed({
    officeId,
    serviceId,
    scheduledAt,
    staffId,
    isInHouse,
  });
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.message, reason: guard.reason },
      { status: guard.status ?? 400 },
    );
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
  let requireApproval = isInHouse ? false : Boolean(
    (officeForApproval?.settings as any)?.require_appointment_approval ??
      ((officeForApproval as any)?.organization?.settings?.require_appointment_approval) ??
      true,
  );
  // Per-customer override: a customer row flagged `auto_approve_reservations`
  // bypasses the approval gate even when the org requires approval. Matching
  // is on (organization_id, phone). Best-effort: lookup failures leave the
  // org-level setting in charge.
  if (requireApproval && cleanCustomerPhone && _bookOrgId) {
    const trusted = await isCustomerAutoApprove(supabase, _bookOrgId, cleanCustomerPhone, officeTz);
    if (trusted) requireApproval = false;
  }
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
      source: resolvedSource,
      ...(staffId ? { staff_id: staffId } : {}),
      ...(typeof cleanPartySize === 'number' ? { party_size: cleanPartySize } : {}),
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
        wilayaCode: cleanWilaya || null,
        source: 'booking',
        timezone: officeTz,
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
        .select('organization:organizations(name, timezone)')
        .eq('id', officeId)
        .single();
      const orgName: string = (officeRow as any)?.organization?.name ?? '';
      // Use org-level timezone as single source of truth
      const orgTz: string = (officeRow as any)?.organization?.timezone || 'Africa/Algiers';
      const dt = new Date(scheduledAt);
      const dateLabel = dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: orgTz });
      const timeParts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: orgTz }).formatToParts(dt);
      const timeLabel = `${timeParts.find(p => p.type === 'hour')?.value ?? '00'}:${timeParts.find(p => p.type === 'minute')?.value ?? '00'}`;
      const locale: Locale = (bodyLocale === 'ar' || bodyLocale === 'en' || bodyLocale === 'fr') ? bodyLocale : 'fr';
      const templateKey = requireApproval ? 'booking_pending_approval' : 'booking_confirmed';
      const messageBody = tMsg(templateKey, locale, {
        name: orgName,
        date: dateLabel,
        time: timeLabel,
        customer: cleanCustomerName,
      });
      await sendWhatsAppMessage({ to: cleanCustomerPhone, body: messageBody, timezone: orgTz });
    }
  } catch (e) {
    console.warn('[book-appointment] whatsapp notify failed:', (e as any)?.message ?? e);
  }

  return NextResponse.json({ appointment }, { status: 201 });
}
