import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;
function getSb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

// POST /api/queue-recovery — trigger immediate recovery + auto-resolve sweep
// Called on app startup, periodically by station, or when operator detects issues
// This runs BOTH legacy recovery AND the new commercial-grade auto-resolve
export async function POST() {
  try {
    const supabase = getSb();

    // Run both in parallel — auto_resolve_tickets is the comprehensive one
    const [recovery, autoResolve] = await Promise.all([
      supabase.rpc('recover_stuck_tickets' as any),
      supabase.rpc('auto_resolve_tickets' as any),
    ]);

    if (recovery.error) {
      console.error('Recovery error:', recovery.error.message);
    }
    if (autoResolve.error) {
      console.error('Auto-resolve error:', autoResolve.error.message);
    }

    return NextResponse.json({
      recovery: recovery.data ?? null,
      autoResolve: autoResolve.data ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
