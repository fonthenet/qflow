import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { upsertCustomerFromBooking } from '@/lib/upsert-customer';

/**
 * POST /api/upsert-customer
 *
 * Lightweight endpoint for desktop/kiosk to upsert a customer record.
 * Uses the unified upsert logic (phone-based dedup, name alias tracking).
 *
 * Body: {
 *   organizationId: string,
 *   name?: string,
 *   phone: string,
 *   email?: string,
 *   wilayaCode?: string,
 *   source?: string,
 *   timezone?: string,
 * }
 *
 * Auth: any valid JWT or service-role key.
 */

export async function POST(request: NextRequest) {
  // Simple auth: accept any Bearer token (JWT or service key)
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { organizationId, name, phone, email, wilayaCode, source, timezone } = body;
  if (!organizationId || !phone) {
    return NextResponse.json({ error: 'organizationId and phone are required' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    await upsertCustomerFromBooking(supabase, {
      organizationId,
      name: name || null,
      phone,
      email: email || null,
      wilayaCode: wilayaCode || null,
      source: source || 'station',
      incrementVisit: false,
      timezone: timezone || null,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Upsert failed' }, { status: 500 });
  }
}
