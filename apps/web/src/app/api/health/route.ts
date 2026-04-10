import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const APP_VERSION = process.env.npm_package_version ?? '0.0.1';

let adminClient: ReturnType<typeof createClient> | null = null;

function getAdminClient() {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const start = performance.now();

  try {
    const supabase = getAdminClient();
    const { error } = await supabase.from('offices').select('id', { count: 'exact', head: true });
    const latency_ms = Math.round(performance.now() - start);

    if (error) {
      return NextResponse.json(
        { status: 'degraded', db: 'disconnected', error: error.message, timestamp },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { status: 'ok', db: 'connected', latency_ms, timestamp, version: APP_VERSION },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const latency_ms = Math.round(performance.now() - start);
    return NextResponse.json(
      {
        status: 'degraded',
        db: 'disconnected',
        error: err instanceof Error ? err.message : 'Unknown error',
        latency_ms,
        timestamp,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
