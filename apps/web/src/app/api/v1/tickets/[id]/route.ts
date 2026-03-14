import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/v1/tickets/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('*, department:departments(name, code), service:services(name, code)')
    .eq('id', id)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // Verify ticket belongs to org
  const { data: office } = await supabase
    .from('offices')
    .select('organization_id')
    .eq('id', ticket.office_id)
    .single();

  if (office?.organization_id !== auth.ctx.organizationId) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  return NextResponse.json({ data: ticket });
}

// PATCH /api/v1/tickets/:id — update ticket status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const body = await request.json();

  const allowedFields = ['status', 'notes', 'customer_data', 'priority'];
  const updates: Record<string, any> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  // Add timestamps based on status changes
  if (updates.status === 'called') updates.called_at = new Date().toISOString();
  if (updates.status === 'serving') updates.serving_started_at = new Date().toISOString();
  if (updates.status === 'served' || updates.status === 'no_show' || updates.status === 'cancelled') {
    updates.completed_at = new Date().toISOString();
  }

  const { data: ticket, error } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: ticket });
}
