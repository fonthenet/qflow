import { NextRequest, NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/google-oauth';

/**
 * GET /api/google/oauth/start?org=<uuid>
 * Redirects the browser to Google's consent screen.
 * The org id is round-tripped in the OAuth `state` parameter.
 */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org');
  if (!orgId) {
    return NextResponse.json({ error: 'Missing org parameter' }, { status: 400 });
  }
  const url = buildAuthUrl(orgId);
  return NextResponse.redirect(url);
}
