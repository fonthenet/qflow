import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const SEND_DELAY_MS = 200;
const MAX_BATCH = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/customer-broadcast
 *
 * Sends a WhatsApp message to a list of customers (by ID) belonging to the
 * authenticated user's organization. Used by Station desktop's Customers modal.
 *
 * Auth: Bearer Supabase JWT (Authorization header)
 *
 * Body: { customerIds: string[]; message: string; filters?: { minVisits?: number; lastVisitDays?: number } }
 *   - If customerIds is empty AND filters provided, sends to all customers matching filters.
 *   - {name} placeholder in message is replaced per recipient.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    // ── Auth: Supabase JWT ──
    const authHeader = request.headers.get('authorization') ?? '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!bearerToken) return jsonResponse({ error: 'Missing bearer token' }, 401);

    const { data: { user } } = await supabase.auth.getUser(bearerToken);
    if (!user) return jsonResponse({ error: 'Invalid token' }, 401);

    const { data: staff } = await supabase
      .from('staff')
      .select('id, organization_id')
      .eq('auth_user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (!staff) return jsonResponse({ error: 'No staff record' }, 403);

    const orgId = (staff as any).organization_id as string;

    // ── Body ──
    const body = await request.json();
    const customerIds: string[] = Array.isArray(body.customerIds) ? body.customerIds : [];
    const message: string = (body.message ?? '').toString().trim();
    const filters = body.filters as { minVisits?: number; lastVisitDays?: number } | undefined;

    if (!message) return jsonResponse({ error: 'Missing message' }, 400);

    // ── Fetch customers ──
    let query = (supabase as any)
      .from('customers')
      .select('id, name, phone')
      .eq('organization_id', orgId)
      .not('phone', 'is', null);

    if (customerIds.length > 0) {
      query = query.in('id', customerIds);
    } else if (filters) {
      if (typeof filters.minVisits === 'number' && filters.minVisits > 0) {
        query = query.gte('visit_count', filters.minVisits);
      }
      if (typeof filters.lastVisitDays === 'number' && filters.lastVisitDays > 0) {
        const since = new Date(Date.now() - filters.lastVisitDays * 86400000).toISOString();
        query = query.gte('last_visit_at', since);
      }
    }

    query = query.limit(MAX_BATCH);

    const { data: customers, error } = await query;
    if (error) return jsonResponse({ error: error.message }, 500);
    if (!customers || customers.length === 0) {
      return jsonResponse({ sent: 0, failed: 0, total: 0, reason: 'no recipients' });
    }

    // ── Send loop ──
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const c of customers as Array<{ id: string; name: string | null; phone: string | null }>) {
      if (!c.phone) { failed++; continue; }
      try {
        const personalMessage = message.replace(/\{name\}/g, c.name || '');
        const result = await sendWhatsAppMessage({ to: c.phone, body: personalMessage });
        if (result.ok) sent++;
        else { failed++; if (errors.length < 10) errors.push(`${c.phone}: ${result.error ?? 'failed'}`); }
      } catch (err: any) {
        failed++;
        if (errors.length < 10) errors.push(`${c.phone}: ${err?.message ?? 'error'}`);
      }
      await sleep(SEND_DELAY_MS);
    }

    return jsonResponse({
      sent,
      failed,
      total: customers.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (err: any) {
    console.error('[customer-broadcast] Error:', err?.message ?? err);
    return jsonResponse({ error: err?.message ?? 'Internal error' }, 500);
  }
}
