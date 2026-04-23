import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractWebhookIp,
  webhookCheckRateLimit,
} from '@/lib/webhook-rate-limit';

// 14-day grace period before records are eligible for hard purge by a
// background job. Soft-delete sets deleted_at now; PII is nulled immediately.
// The grace period exists so the org admin can cancel accidental deletions
// within the window. LAWYER REVIEW REQUIRED: confirm grace period is
// acceptable under applicable erasure obligations (GDPR Art. 17 requires
// "without undue delay" — 14 days is considered reasonable for controller
// data but should be confirmed with counsel).

export async function POST(req: Request) {
  // ── 1. IP flood guard ─────────────────────────────────────────────────────
  const ip = extractWebhookIp(req.headers);
  const flood = webhookCheckRateLimit(ip, { limit: 10, windowMs: 60_000 });
  if (!flood.allowed) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      {
        status: 429,
        headers: { 'Retry-After': String(flood.retryAfterSeconds) },
      }
    );
  }

  // ── 2. Authenticate ───────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 3. Parse body: optional customer_id or "self" (delete own account data)
  let body: { customer_id?: string; scope?: 'self' | 'customer' } = {};
  try {
    body = await req.json();
  } catch {
    // No body — default to self
  }

  const admin = createAdminClient();

  // ── 4. Resolve org ────────────────────────────────────────────────────────
  const { data: staffRow } = await admin
    .from('staff')
    .select('organization_id, role, id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!staffRow) {
    return NextResponse.json(
      { error: 'No staff record found.' },
      { status: 403 }
    );
  }

  const orgId = staffRow.organization_id;
  const now = new Date().toISOString();

  // ── 5. Scope: delete a specific customer record (org admin only) ──────────
  if (body.scope === 'customer' && body.customer_id) {
    const adminRoles = ['admin', 'manager'];
    if (!adminRoles.includes(staffRow.role)) {
      return NextResponse.json(
        { error: 'Only org admins may delete customer records.' },
        { status: 403 }
      );
    }

    // Verify the customer belongs to this org (cross-tenant guard)
    const { data: customer, error: fetchErr } = await admin
      .from('customers')
      .select('id, organization_id')
      .eq('id', body.customer_id)
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (fetchErr || !customer) {
      return NextResponse.json(
        { error: 'Customer not found in your organization.' },
        { status: 404 }
      );
    }

    // PII minimization + soft-delete in one update
    const { error: updateErr } = await admin
      .from('customers')
      .update({
        name: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        customer_file: null,
        date_of_birth: null,
        spouse_name: null,
        spouse_dob: null,
        previous_names: null,
        deleted_at: now,
        updated_at: now,
      } as Record<string, unknown>)
      .eq('id', body.customer_id)
      .eq('organization_id', orgId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      deleted_at: now,
      grace_period_ends: new Date(
        Date.parse(now) + 14 * 24 * 60 * 60 * 1000
      ).toISOString(),
      message:
        'Customer PII has been nulled and the record soft-deleted. Hard purge will occur after the 14-day grace period.',
    });
  }

  // ── 6. Scope: self — delete own staff account data ────────────────────────
  // Nulls PII on the staff row. The auth.users row is NOT deleted here;
  // that must be handled via Supabase auth admin API (requires a separate
  // privileged call — LAWYER REVIEW REQUIRED on whether this satisfies
  // erasure requests for authenticated users under GDPR Art. 17).

  const { error: selfErr } = await admin
    .from('staff')
    .update({
      // Staff PII minimization — keep role/org for audit log integrity
      full_name: '[DELETED]',
      email: '[DELETED]',
      updated_at: now,
    } as Record<string, unknown>)
    .eq('id', staffRow.id);

  if (selfErr) {
    return NextResponse.json({ error: selfErr.message }, { status: 500 });
  }

  // Also sign out the session
  await supabase.auth.signOut();

  return NextResponse.json({
    ok: true,
    deleted_at: now,
    grace_period_ends: new Date(
      Date.parse(now) + 14 * 24 * 60 * 60 * 1000
    ).toISOString(),
    message:
      'Your account PII has been minimized. Full auth record deletion requires contacting privacy@qflo.app.',
  });
}
