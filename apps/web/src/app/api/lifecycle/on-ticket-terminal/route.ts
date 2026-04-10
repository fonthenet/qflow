import { NextRequest, NextResponse } from 'next/server';
import { onTicketTerminal } from '@/lib/lifecycle';
import { safeCompare } from '@/lib/crypto-utils';

/**
 * POST /api/lifecycle/on-ticket-terminal
 *
 * Thin wrapper around the lifecycle module for desktop/mobile callers
 * that can't import server-only code.
 *
 * Body: { ticketId, terminalStatus, newTicketId? }
 * Auth: Bearer (service role key, webhook secret, or valid JWT)
 */
export async function POST(request: NextRequest) {
  // Authenticate
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearerToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  const isServiceAuth = (serviceKey && safeCompare(bearerToken, serviceKey))
    || (webhookSecret && safeCompare(bearerToken, webhookSecret));

  if (!isServiceAuth) {
    // Check JWT
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data: { user }, error } = await sb.auth.getUser(bearerToken);
      if (error || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: { ticketId?: string; terminalStatus?: string; newTicketId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { ticketId, terminalStatus, newTicketId } = body;
  const validStatuses = ['served', 'cancelled', 'no_show', 'transferred'];
  if (!ticketId || !terminalStatus || !validStatuses.includes(terminalStatus)) {
    return NextResponse.json(
      { error: 'ticketId and terminalStatus (served|cancelled|no_show|transferred) are required' },
      { status: 400 },
    );
  }

  await onTicketTerminal(ticketId, terminalStatus as any, { newTicketId });

  return NextResponse.json({ ok: true });
}
