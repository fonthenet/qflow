import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractWebhookIp,
  webhookCheckRateLimit,
} from '@/lib/webhook-rate-limit';

// 30-day rate limit: 1 export per user per window (keyed by user-id, not IP,
// for accuracy — IP-bucket from webhookCheckRateLimit is reused for the initial
// flood guard, DB record is the authoritative 30-day gate).
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  // ── 1. IP-level flood guard (in-memory, short window) ────────────────────
  const ip = extractWebhookIp(req.headers);
  const flood = webhookCheckRateLimit(ip, { limit: 5, windowMs: 60_000 });
  if (!flood.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before retrying.' },
      {
        status: 429,
        headers: { 'Retry-After': String(flood.retryAfterSeconds) },
      }
    );
  }

  // ── 2. Authenticate user ──────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // ── 3. 30-day rate limit (per-user, DB-backed) ────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: exportRecord } = await (admin as any)
    .from('user_data_exports')
    .select('last_export_at, export_count')
    .eq('user_id', user.id)
    .maybeSingle();

  if (exportRecord) {
    const lastExport = new Date(exportRecord.last_export_at).getTime();
    if (Date.now() - lastExport < THIRTY_DAYS_MS) {
      const nextAllowed = new Date(lastExport + THIRTY_DAYS_MS).toISOString();
      return NextResponse.json(
        {
          error: 'Export limit reached. One export per 30 days is allowed.',
          next_allowed_at: nextAllowed,
        },
        { status: 429 }
      );
    }
  }

  // ── 4. Resolve org membership ─────────────────────────────────────────────
  const { data: staffRow } = await admin
    .from('staff')
    .select('organization_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!staffRow) {
    return NextResponse.json(
      { error: 'No staff record found for this user.' },
      { status: 403 }
    );
  }

  const orgId = staffRow.organization_id;

  // ── 5. Fetch data scoped to the user's org ────────────────────────────────
  const [
    { data: customers },
    { data: tickets },
    { data: payments },
    { data: appointments },
    { data: paymentEvents },
    { data: userProfile },
  ] = await Promise.all([
    admin
      .from('customers')
      .select('*')
      .eq('organization_id', orgId)
      .is('deleted_at', null),

    admin
      .from('tickets')
      .select(
        'id, ticket_number, status, created_at, called_at, completed_at, customer_id, office_id, department_id, service_id, locale, source'
      )
      .eq('office_id', orgId) // tickets are scoped by office → org via org relation; use org filter via departments
      // Note: tickets table scopes by office_id not org directly.
      // We join via org to ensure tenancy. Using a safe alternative:
      // fetch org's office ids first and filter — done below via RLS-safe approach.
      .limit(0), // placeholder — overridden below

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from('ticket_payments')
      .select('id, ticket_id, amount, method, paid_at, currency:method')
      .eq('organization_id', orgId),

    admin
      .from('appointments')
      .select('id, status, created_at, scheduled_at:start_time, service_id, office_id, notes')
      .eq('office_id', orgId) // placeholder — overridden below
      .limit(0),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from('payment_events')
      .select(
        'id, event_type, provider, status, amount, currency, received_at, minimized_at, purged_at'
      )
      .eq('organization_id', orgId),

    admin
      .from('staff')
      .select('id, full_name, email, role, organization_id, created_at')
      .eq('auth_user_id', user.id)
      .maybeSingle(),
  ]);

  // Re-fetch tickets and appointments properly scoped by org's offices
  const { data: offices } = await admin
    .from('offices')
    .select('id')
    .eq('organization_id', orgId);

  const officeIds = (offices ?? []).map((o: { id: string }) => o.id);

  const [{ data: ticketsScoped }, { data: appointmentsScoped }] =
    await Promise.all([
      officeIds.length
        ? admin
            .from('tickets')
            .select(
              'id, ticket_number, status, created_at, called_at, completed_at, customer_id, office_id, department_id, service_id, locale, source'
            )
            .in('office_id', officeIds)
        : Promise.resolve({ data: [] }),

      officeIds.length
        ? admin
            .from('appointments')
            .select(
              'id, status, created_at, office_id, service_id, notes'
            )
            .in('office_id', officeIds)
        : Promise.resolve({ data: [] }),
    ]);

  // ── 6. Record this export ─────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('user_data_exports').upsert(
    {
      user_id: user.id,
      last_export_at: new Date().toISOString(),
      export_count: (exportRecord?.export_count ?? 0) + 1,
    },
    { onConflict: 'user_id' }
  );

  // ── 7. Build and return the bundle ────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10);
  const bundle = {
    exported_at: new Date().toISOString(),
    exported_by: user.id,
    organization_id: orgId,
    user_profile: userProfile ?? null,
    customers: customers ?? [],
    tickets: ticketsScoped ?? [],
    payments: payments ?? [],
    appointments: appointmentsScoped ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payment_events: (paymentEvents ?? []).map((pe: any) => ({
      ...pe,
      // Minimized rows: raw_payload already stripped by DB job; flag presence.
      is_minimized: pe.minimized_at !== null,
    })),
  };

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="qflo-data-export-${dateStr}.json"`,
      'Cache-Control': 'no-store, no-cache',
    },
  });
}
