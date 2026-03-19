import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;
function getSb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

// POST /api/queue-recovery — trigger immediate recovery sweep
// Called on app startup or when operator detects issues
export async function POST() {
  try {
    const supabase = getSb();
    const { data, error } = await supabase.rpc('recover_stuck_tickets' as any);

    if (error) {
      console.error('Recovery error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ result: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
