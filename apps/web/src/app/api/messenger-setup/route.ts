import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/** Constant-time string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * POST /api/messenger-setup
 *
 * One-time setup: configures the Facebook Page for Messenger webhooks.
 * - Subscribes the page to receive messaging events
 * - Sets up the "Get Started" button (required for m.me referrals to work for new users)
 * - Configures greeting text
 *
 * Requires: MESSENGER_PAGE_ACCESS_TOKEN env var
 * Auth: service role key or webhook secret
 */

const PAGE_ID = '1097672690089929';
const GRAPH_API = 'https://graph.facebook.com/v22.0';

export async function POST(request: NextRequest) {
  // Auth check — full token comparison with timing-safe equal
  const authHeader = request.headers.get('authorization') ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const isServiceKey = serviceKey && safeCompare(bearerToken, serviceKey);
  const isWebhookSecret = webhookSecret && safeCompare(bearerToken, webhookSecret);
  if (!isServiceKey && !isWebhookSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pageToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN?.trim();
  if (!pageToken) {
    return NextResponse.json({ error: 'MESSENGER_PAGE_ACCESS_TOKEN not set' }, { status: 500 });
  }

  const results: Record<string, any> = {};

  // 1. Subscribe page to webhook fields
  try {
    const subRes = await fetch(`${GRAPH_API}/${PAGE_ID}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribed_fields: ['messages', 'messaging_postbacks', 'messaging_referrals', 'messaging_optins'],
        access_token: pageToken,
      }),
    });
    const subData = await subRes.json();
    results.subscribe = { status: subRes.status, data: subData };
    console.log('[messenger-setup] Subscribe:', subRes.status, JSON.stringify(subData));
  } catch (err: any) {
    results.subscribe = { error: err?.message };
  }

  // 2. Set up "Get Started" button + greeting
  try {
    const profileRes = await fetch(`${GRAPH_API}/${PAGE_ID}/messenger_profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        get_started: { payload: 'GET_STARTED' },
        greeting: [
          { locale: 'default', text: 'Welcome to Qflo! Tap Get Started to connect your ticket.' },
          { locale: 'fr_FR', text: 'Bienvenue sur Qflo ! Appuyez sur Démarrer pour connecter votre ticket.' },
          { locale: 'ar_AR', text: 'مرحبًا بك في Qflo! اضغط على ابدأ لربط تذكرتك.' },
        ],
        access_token: pageToken,
      }),
    });
    const profileData = await profileRes.json();
    results.messenger_profile = { status: profileRes.status, data: profileData };
    console.log('[messenger-setup] Profile:', profileRes.status, JSON.stringify(profileData));
  } catch (err: any) {
    results.messenger_profile = { error: err?.message };
  }

  // 3. Verify current subscriptions
  try {
    const checkRes = await fetch(
      `${GRAPH_API}/${PAGE_ID}/subscribed_apps?access_token=${pageToken}`
    );
    const checkData = await checkRes.json();
    results.current_subscriptions = checkData;
  } catch (err: any) {
    results.current_subscriptions = { error: err?.message };
  }

  // 4. Verify messenger profile
  try {
    const profileCheckRes = await fetch(
      `${GRAPH_API}/${PAGE_ID}/messenger_profile?fields=get_started,greeting&access_token=${pageToken}`
    );
    const profileCheckData = await profileCheckRes.json();
    results.current_profile = profileCheckData;
  } catch (err: any) {
    results.current_profile = { error: err?.message };
  }

  return NextResponse.json({ ok: true, results });
}

/**
 * GET /api/messenger-setup
 *
 * Diagnostic: checks current Facebook Page configuration.
 */
export async function GET() {
  const pageToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN?.trim();
  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN?.trim();
  const appSecret = process.env.MESSENGER_APP_SECRET?.trim();

  const diagnostics: Record<string, any> = {
    env: {
      MESSENGER_PAGE_ACCESS_TOKEN: pageToken ? '✅ set' : '❌ missing',
      MESSENGER_VERIFY_TOKEN: verifyToken ? '✅ set' : '❌ missing',
      MESSENGER_APP_SECRET: appSecret ? '✅ set' : '⚠️ missing (signature verification disabled)',
    },
  };

  if (!pageToken) {
    return NextResponse.json({ ok: false, diagnostics, error: 'MESSENGER_PAGE_ACCESS_TOKEN not set' });
  }

  // Check page subscriptions
  try {
    const subRes = await fetch(
      `${GRAPH_API}/${PAGE_ID}/subscribed_apps?access_token=${pageToken}`
    );
    const subData = await subRes.json();
    diagnostics.subscribed_apps = subData;
  } catch (err: any) {
    diagnostics.subscribed_apps = { error: err?.message };
  }

  // Check messenger profile (Get Started button)
  try {
    const profileRes = await fetch(
      `${GRAPH_API}/${PAGE_ID}/messenger_profile?fields=get_started,greeting&access_token=${pageToken}`
    );
    const profileData = await profileRes.json();
    diagnostics.messenger_profile = profileData;
  } catch (err: any) {
    diagnostics.messenger_profile = { error: err?.message };
  }

  // Check page info
  try {
    const pageRes = await fetch(
      `${GRAPH_API}/${PAGE_ID}?fields=name,id&access_token=${pageToken}`
    );
    const pageData = await pageRes.json();
    diagnostics.page = pageData;
  } catch (err: any) {
    diagnostics.page = { error: err?.message };
  }

  return NextResponse.json({ ok: true, diagnostics });
}
