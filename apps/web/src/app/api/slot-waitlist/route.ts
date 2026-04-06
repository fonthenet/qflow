import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  const { officeId, serviceId, date, time, customerName, customerPhone, customerEmail } =
    body as Record<string, string | undefined>;

  if (!officeId || !serviceId || !date || !time || !customerName) {
    return NextResponse.json(
      { error: 'Missing required fields: officeId, serviceId, date, time, customerName' },
      { status: 400 }
    );
  }

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format. Expected YYYY-MM-DD' }, { status: 400 });
  }

  // Validate time format (HH:MM)
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: 'Invalid time format. Expected HH:MM' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Verify office exists
  const { data: office, error: officeError } = await supabase
    .from('offices')
    .select('id')
    .eq('id', officeId)
    .single();

  if (officeError || !office) {
    return NextResponse.json({ error: 'Office not found' }, { status: 404 });
  }

  // Insert into waitlist
  const { data: entry, error } = await (supabase.from('slot_waitlist' as any) as any)
    .insert({
      office_id: officeId,
      service_id: serviceId,
      date,
      time,
      customer_name: customerName.trim(),
      customer_phone: customerPhone?.trim() || null,
      customer_email: customerEmail?.trim() || null,
      status: 'waiting',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Calculate position in waitlist for this slot
  const { count } = await (supabase.from('slot_waitlist' as any) as any)
    .select('id', { count: 'exact', head: true })
    .eq('office_id', officeId)
    .eq('service_id', serviceId)
    .eq('date', date)
    .eq('time', time)
    .eq('status', 'waiting');

  return NextResponse.json(
    { success: true, position: count ?? 1, entry },
    { status: 201 }
  );
}
