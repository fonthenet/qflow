import { NextResponse } from 'next/server';
import { readEmbeddedSignupEnv } from '@/lib/whatsapp/embedded-signup';

export const runtime = 'nodejs';

/**
 * GET /api/whatsapp/embedded-signup/config
 *
 * Returns { enabled, appId, configId } so the browser can decide whether to
 * render the "Connect WhatsApp" button. Returns enabled=false + empty IDs
 * when the env vars haven't been set up yet — the UI shows a disabled
 * button with an explanation in that case. Safe to be public (no secrets).
 */
export async function GET() {
  const env = readEmbeddedSignupEnv();
  if (!env) {
    return NextResponse.json({ enabled: false, appId: '', configId: '' });
  }
  return NextResponse.json({
    enabled: true,
    appId: env.publicAppId,
    configId: env.configId,
  });
}
