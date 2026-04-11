import { NextRequest, NextResponse } from 'next/server';
import { getQueuePosition } from '@/lib/queue-position';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      `
      id,
      qr_token,
      office_id,
      department_id,
      service_id,
      ticket_number,
      status,
      desk_id,
      called_at,
      serving_started_at,
      completed_at,
      called_by_staff_id,
      estimated_wait_minutes,
      recall_count,
      customer_data,
      is_remote,
      priority,
      created_at
    `
    )
    .eq('qr_token', token)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // Use canonical queue position calculation (department-scoped, priority+FIFO)
  const queueInfo = await getQueuePosition(ticket.id);

  const [
    officeResult,
    departmentResult,
    serviceResult,
    deskResult,
  ] = await Promise.all([
    supabase
      .from('offices')
      .select('id, name, organization_id')
      .eq('id', ticket.office_id)
      .single(),
    supabase
      .from('departments')
      .select('id, name, code')
      .eq('id', ticket.department_id)
      .single(),
    ticket.service_id
      ? supabase
          .from('services')
          .select('id, name, code')
          .eq('id', ticket.service_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    ticket.desk_id
      ? supabase
          .from('desks')
          .select('id, name, display_name')
          .eq('id', ticket.desk_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const responsePayload = {
    ...ticket,
    position: queueInfo.position,
    estimated_wait_minutes: queueInfo.estimated_wait_minutes ?? ticket.estimated_wait_minutes,
    office: officeResult.data ?? null,
    department: departmentResult.data ?? null,
    service: serviceResult.data ?? null,
    desk: deskResult.data ?? null,
    now_serving: queueInfo.now_serving,
  };

  return NextResponse.json(responsePayload);
}
