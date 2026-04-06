import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { getAvailableSlots } from '@/lib/slot-generator';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const slug = searchParams.get('slug')?.trim();
  const serviceId = searchParams.get('serviceId')?.trim();
  const date = searchParams.get('date')?.trim(); // YYYY-MM-DD
  const staffId = searchParams.get('staffId')?.trim() || undefined;

  if (!slug || !serviceId || !date) {
    return NextResponse.json({ error: 'Missing slug, serviceId, or date' }, { status: 400 });
  }

  const supabase = getSupabase();

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

  // Return backward-compatible format (slots as string[] for existing consumers)
  // PLUS the new enriched format
  return NextResponse.json({
    officeId: result.officeId,
    date: result.date,
    slots: result.slots.map(s => s.time), // backward compat: string[]
    slotsDetailed: result.slots, // new: { time, remaining, total }[]
    meta: result.meta,
  });
}
