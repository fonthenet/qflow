import { NextResponse } from 'next/server';

/**
 * Runtime config endpoint for portable/Electron mode.
 * Returns Supabase credentials and app settings from environment variables
 * that were injected at runtime (not baked at build time).
 */
export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    appName: process.env.QUEUEFLOW_APP_NAME || 'QueueFlow',
    offlineOnly: process.env.QUEUEFLOW_OFFLINE_ONLY === 'true',
    isPortable: process.env.QUEUEFLOW_PORTABLE === 'true',
  });
}
