import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function createServiceSupabaseClient() {
  const url = (process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'] ?? '').trim();
  const key = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    const { token, name, phone, reason } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const supabase = createServiceSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Look up ticket by qr_token
    const { data: ticket, error: fetchError } = await supabase
      .from('tickets')
      .select('id, status, customer_data')
      .eq('qr_token', token)
      .single();

    if (fetchError || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Only allow editing while ticket is active
    const editable = ['waiting', 'called'].includes(ticket.status);
    if (!editable) {
      return NextResponse.json({ error: 'Ticket is no longer editable' }, { status: 409 });
    }

    const existing = (ticket.customer_data as Record<string, string>) ?? {};
    const updated: Record<string, string> = { ...existing };
    if (name && typeof name === 'string') updated['name'] = name.trim();
    if (phone !== undefined && typeof phone === 'string') updated['phone'] = phone.trim();
    if (reason !== undefined && typeof reason === 'string') updated['reason'] = reason.trim();

    const { error: updateError } = await supabase
      .from('tickets')
      .update({ customer_data: updated })
      .eq('id', ticket.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
