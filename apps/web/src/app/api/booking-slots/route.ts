import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { getDateStartIso, getDateEndIso } from '@/lib/office-day';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function generateSlots(openTime: string, closeTime: string, durationMinutes: number): string[] {
  const slots: string[] = [];
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  let h = openH, m = openM;
  while (h < closeH || (h === closeH && m < closeM)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += durationMinutes;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }
  return slots;
}

function isSlotBlocked(
  slotTime: string,
  blockedRanges: { start_time: string; end_time: string }[]
): boolean {
  return blockedRanges.some((b) => slotTime >= b.start_time && slotTime < b.end_time);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const slug = searchParams.get('slug')?.trim();
  const serviceId = searchParams.get('serviceId')?.trim();
  const date = searchParams.get('date')?.trim(); // YYYY-MM-DD

  if (!slug || !serviceId || !date) {
    return NextResponse.json({ error: 'Missing slug, serviceId, or date' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Resolve office by slug (include organization for settings)
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, settings, operating_hours, organization_id, timezone')
    .eq('is_active', true);

  const office = (offices ?? []).find((o: any) => matchesOfficePublicSlug(o, slug));
  if (!office) return NextResponse.json({ error: 'Office not found' }, { status: 404 });

  // Fetch org settings
  const { data: org } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', (office as any).organization_id)
    .single();

  const orgSettings = (org?.settings as Record<string, any> | null) ?? {};
  const bookingMode = orgSettings.booking_mode ?? 'simple';
  const bookingHorizonDays = Number(orgSettings.booking_horizon_days ?? 7);
  const slotDurationMinutes = Number(orgSettings.slot_duration_minutes ?? 30);
  const slotsPerInterval = Number(orgSettings.slots_per_interval ?? 1);
  const allowCancellation = Boolean(orgSettings.allow_cancellation ?? false);

  const meta = {
    booking_mode: bookingMode,
    booking_horizon_days: bookingHorizonDays,
    slot_duration_minutes: slotDurationMinutes,
    slots_per_interval: slotsPerInterval,
    allow_cancellation: allowCancellation,
  };

  // Check if booking is disabled
  if (bookingMode === 'disabled') {
    return NextResponse.json({ error: 'Booking is disabled for this business', meta }, { status: 403 });
  }

  // Validate date is within booking horizon (compare date strings to avoid timezone issues)
  const todayStr = new Date().toISOString().split('T')[0];
  const maxD = new Date(todayStr + 'T12:00:00');
  maxD.setDate(maxD.getDate() + bookingHorizonDays);
  const maxDateStr = maxD.toISOString().split('T')[0];
  if (date < todayStr || date > maxDateStr) {
    return NextResponse.json({ officeId: office.id, date, slots: [], meta });
  }

  // Determine available slots from operating hours
  const operatingHours = (office.operating_hours as Record<string, { open: string; close: string }> | null) ?? {};
  const dayOfWeek = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dayHours = operatingHours[dayOfWeek] ?? { open: '08:00', close: '17:00' };
  const allSlots = generateSlots(dayHours.open, dayHours.close, slotDurationMinutes);

  // Fetch existing appointments
  const appointmentsResult = await supabase
    .from('appointments')
    .select('scheduled_at')
    .eq('office_id', office.id)
    .eq('service_id', serviceId)
    .neq('status', 'cancelled')
    .gte('scheduled_at', getDateStartIso(date, (office as any).timezone))
    .lte('scheduled_at', getDateEndIso(date, (office as any).timezone));

  // Fetch blocked slots (graceful — table may not exist yet)
  let blockedData: { start_time: string; end_time: string }[] = [];
  try {
    const blockedResult = await supabase
      .from('blocked_slots')
      .select('start_time, end_time')
      .eq('office_id', office.id)
      .eq('blocked_date', date);
    blockedData = (blockedResult.data ?? []) as { start_time: string; end_time: string }[];
  } catch {
    // Table may not exist yet — treat as no blocked slots
  }

  // Count bookings per slot time (for capacity check)
  const slotBookingCounts = new Map<string, number>();
  for (const a of appointmentsResult.data ?? []) {
    const d = new Date(a.scheduled_at);
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    slotBookingCounts.set(t, (slotBookingCounts.get(t) ?? 0) + 1);
  }

  const now = new Date();
  const isToday = date === now.toISOString().split('T')[0];

  const available = allSlots.filter((slot) => {
    // Check capacity
    if ((slotBookingCounts.get(slot) ?? 0) >= slotsPerInterval) return false;
    // Check blocked
    if (isSlotBlocked(slot, blockedData)) return false;
    // Check past
    if (isToday) {
      const slotDate = new Date(`${date}T${slot}:00`);
      if (slotDate <= now) return false;
    }
    return true;
  });

  return NextResponse.json({ officeId: office.id, date, slots: available, meta });
}
