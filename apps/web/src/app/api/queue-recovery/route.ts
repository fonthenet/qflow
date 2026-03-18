import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// POST /api/queue-recovery — trigger immediate recovery sweep
// Called on app startup or when operator detects issues
export async function POST() {
  try {
    const { data, error } = await supabase.rpc('recover_stuck_tickets');

    if (error) {
      console.error('Recovery error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ result: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
