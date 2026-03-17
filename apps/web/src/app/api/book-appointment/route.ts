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

  const { officeId, departmentId, serviceId, customerName, customerPhone, scheduledAt } =
    body as Record<string, string | undefined>;

  if (!officeId || !departmentId || !serviceId || !customerName || !scheduledAt) {
    return NextResponse.json(
      { error: 'Missing required fields: officeId, departmentId, serviceId, customerName, scheduledAt' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      office_id: officeId,
      department_id: departmentId,
      service_id: serviceId,
      customer_name: customerName.trim(),
      customer_phone: customerPhone?.trim() || null,
      scheduled_at: scheduledAt,
      status: 'pending',
    })
    .select('id, office_id, department_id, service_id, customer_name, customer_phone, scheduled_at, status')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ appointment }, { status: 201 });
}
