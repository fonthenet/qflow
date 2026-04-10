import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { transitionAppointment } from '@/lib/lifecycle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Auto no-show cron.
 *
 * Marks any pending/confirmed appointment whose scheduled time is more than
 * 60 minutes in the past as `no_show`. Uses the centralized lifecycle module
 * so linked tickets are also marked and customers are notified.
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

  // Find stale appointments (don't update directly — let lifecycle handle each)
  const { data, error } = await supabase
    .from('appointments')
    .select('id')
    .in('status', ['pending', 'confirmed'])
    .lt('scheduled_at', cutoff);

  if (error) {
    console.error('[cron/mark-no-shows] query failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const appointments = Array.isArray(data) ? data : [];
  let updated = 0;

  for (const appt of appointments) {
    const result = await transitionAppointment(appt.id, 'no_show', {
      skipNotify: false, // notify customers they were marked no-show
    });
    if (result.ok) updated++;
  }

  if (updated > 0) {
    console.log(`[cron/mark-no-shows] marked ${updated} appointment(s) as no_show via lifecycle`);
  }

  return NextResponse.json({ updated, cutoff });
}
