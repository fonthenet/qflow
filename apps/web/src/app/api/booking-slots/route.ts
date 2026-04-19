import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { getAvailableSlots } from '@/lib/slot-generator';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const slug = searchParams.get('slug')?.trim();
  const serviceId = searchParams.get('serviceId')?.trim();
  const date = searchParams.get('date')?.trim(); // YYYY-MM-DD
  const staffId = searchParams.get('staffId')?.trim() || undefined;

  if (!slug || !serviceId || !date) {
    return NextResponse.json({ error: 'Missing slug, serviceId, or date' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Resolve office by slug
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, settings, operating_hours, organization_id, timezone')
    .eq('is_active', true);

  // Try matching by ID first (for Station desktop), then by slug
  const office = (offices ?? []).find((o: any) => o.id === slug) ?? (offices ?? []).find((o: any) => matchesOfficePublicSlug(o, slug));
  if (!office) return NextResponse.json({ error: 'Office not found' }, { status: 404 });

  // Use centralized slot generator
  const result = await getAvailableSlots({
    officeId: office.id,
    serviceId,
    date,
    staffId,
  });

  // Check if booking is disabled
  if (result.meta.booking_mode === 'disabled') {
    return NextResponse.json(
      { error: 'Booking is disabled for this business', meta: result.meta },
      { status: 403 }
    );
  }

  // Backward-compat `slots` is **available-only** string[] so old clients
  // that just iterate `slots` never offer a taken time. New clients use
  // `slotsDetailed` which includes taken slots with `available:false`.
  const bookable = result.slots.filter(s => s.available !== false);
  return NextResponse.json({
    officeId: result.officeId,
    date: result.date,
    slots: bookable.map(s => s.time), // backward compat: string[] of bookable only
    slotsDetailed: result.slots, // full list — taken included, with `available` flag
    meta: result.meta,
    timezone: (office as any).timezone ?? null,
  });
}
