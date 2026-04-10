import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Orphaned WhatsApp session cleanup cron.
 *
 * - Deletes `whatsapp_sessions` in `pending_confirmation` state older than 24 hours.
 * - Deletes `whatsapp_sessions` in `idle` state older than 7 days.
 *
 * Vercel Cron: configured in apps/web/vercel.json (every 6 hours).
 * Auth: Bearer CRON_SECRET (env var).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase: any = createAdminClient();

  // 1. Delete pending_confirmation sessions older than 24 hours
  const pendingCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: pendingDeleted, error: pendingError } = await supabase
    .from('whatsapp_sessions')
    .delete()
    .eq('state', 'pending_confirmation')
    .lt('created_at', pendingCutoff)
    .select('id');

  if (pendingError) {
    console.error('[cron/cleanup-sessions] pending_confirmation cleanup failed:', pendingError.message);
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  const pendingCount = Array.isArray(pendingDeleted) ? pendingDeleted.length : 0;

  // 2. Delete idle sessions older than 7 days
  const idleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: idleDeleted, error: idleError } = await supabase
    .from('whatsapp_sessions')
    .delete()
    .eq('state', 'idle')
    .lt('updated_at', idleCutoff)
    .select('id');

  if (idleError) {
    console.error('[cron/cleanup-sessions] idle cleanup failed:', idleError.message);
    return NextResponse.json({ error: idleError.message }, { status: 500 });
  }

  const idleCount = Array.isArray(idleDeleted) ? idleDeleted.length : 0;

  if (pendingCount > 0 || idleCount > 0) {
    console.log(`[cron/cleanup-sessions] cleaned up ${pendingCount} stale pending_confirmation, ${idleCount} stale idle session(s)`);
  }

  return NextResponse.json({
    pending_confirmation_deleted: pendingCount,
    pending_cutoff: pendingCutoff,
    idle_deleted: idleCount,
    idle_cutoff: idleCutoff,
  });
}
