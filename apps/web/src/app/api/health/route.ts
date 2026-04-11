import { NextResponse } from 'next/server';

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    const start = Date.now();
    const { error } = await supabase
      .from('organizations')
      .select('id')
      .limit(1);
    const latency_ms = Date.now() - start;

    if (error) {
      return NextResponse.json(
        { status: 'degraded', db: 'error', error: error.message, timestamp },
        { status: 503 },
      );
    }

    return NextResponse.json({
      status: 'ok',
      db: 'connected',
      latency_ms,
      timestamp,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { status: 'degraded', db: 'error', error: message, timestamp },
      { status: 503 },
    );
  }
}
