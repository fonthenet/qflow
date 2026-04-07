import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Auto no-show cron.
 *
 * Marks any pending/confirmed appointment whose scheduled time is more than
 * 60 minutes in the past as `no_show`. Frees the slot for re-booking (the
 * partial unique index `uniq_appointments_active_slot` only applies to
 * active statuses, so no_show no longer occupies the slot).
 *
 * Vercel Cron: configured in apps/web/vercel.json (every 10 minutes).
 * Auth: Bearer CRON_SECRET (env var).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase: any = createAdminClient();

  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'no_show' })
    .in('status', ['pending', 'confirmed'])
    .lt('scheduled_at', cutoff)
    .select('id');

  if (error) {
    console.error('[cron/mark-no-shows] update failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updated = Array.isArray(data) ? data.length : 0;
  if (updated > 0) {
    console.log(`[cron/mark-no-shows] marked ${updated} appointment(s) as no_show`);
  }

  return NextResponse.json({ updated, cutoff });
}
