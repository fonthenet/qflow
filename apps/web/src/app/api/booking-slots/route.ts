import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function slugifyOfficeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function matchesSlug(office: { name: string; settings?: unknown }, slug: string) {
  const s = office.settings && typeof office.settings === 'object' && !Array.isArray(office.settings)
    ? (office.settings as Record<string, unknown>)
    : {};
  const configured = s.platform_office_slug;
  const effective = typeof configured === 'string' && configured.trim()
    ? configured
    : slugifyOfficeName(office.name);
  return effective === slug;
}

function generateSlots(openTime: string, closeTime: string): string[] {
  const slots: string[] = [];
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  let h = openH, m = openM;
  while (h < closeH || (h === closeH && m < closeM)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += 30;
    if (m >= 60) { m -= 60; h += 1; }
  }
  return slots;
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

  // Resolve office by slug
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, settings, operating_hours')
    .eq('is_active', true);

  const office = (offices ?? []).find((o: any) => matchesSlug(o, slug));
  if (!office) return NextResponse.json({ error: 'Office not found' }, { status: 404 });

  // Determine available slots from operating hours
  const operatingHours = (office.operating_hours as Record<string, { open: string; close: string }> | null) ?? {};
  const dayOfWeek = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dayHours = operatingHours[dayOfWeek] ?? { open: '08:00', close: '17:00' };
  const allSlots = generateSlots(dayHours.open, dayHours.close);

  // Fetch existing appointments for this service on this date
  const { data: existing } = await supabase
    .from('appointments')
    .select('scheduled_at')
    .eq('office_id', office.id)
    .eq('service_id', serviceId)
    .neq('status', 'cancelled')
    .gte('scheduled_at', `${date}T00:00:00`)
    .lte('scheduled_at', `${date}T23:59:59`);

  const bookedTimes = new Set(
    (existing ?? []).map((a: any) => {
      const d = new Date(a.scheduled_at);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    })
  );

  const now = new Date();
  const isToday = date === now.toISOString().split('T')[0];

  const available = allSlots.filter((slot) => {
    if (bookedTimes.has(slot)) return false;
    if (isToday) {
      const [h, m] = slot.split(':').map(Number);
      const slotDate = new Date(`${date}T${slot}:00`);
      if (slotDate <= now) return false;
    }
    return true;
  });

  return NextResponse.json({ officeId: office.id, date, slots: available });
}
