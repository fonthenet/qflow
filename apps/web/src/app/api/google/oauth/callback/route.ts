import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, getUserEmail } from '@/lib/google-oauth';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/google/oauth/callback?code=...&state=<orgId>
 * Exchanges the auth code for tokens and stores them keyed by org.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const orgId = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return htmlResponse(`<h1>Connection cancelled</h1><p>${escapeHtml(error)}</p>`);
  }
  if (!code || !orgId) {
    return htmlResponse('<h1>Missing code or state</h1>', 400);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      return htmlResponse(
        '<h1>Missing refresh token</h1><p>Please disconnect this app from your Google account and try again.</p>',
        400,
      );
    }
    const email = await getUserEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const sb = createAdminClient() as any;
    await sb.from('google_connections').upsert(
      {
        organization_id: orgId,
        google_email: email,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        token_expires_at: expiresAt,
      },
      { onConflict: 'organization_id' },
    );

    return htmlResponse(`
      <html>
        <head><title>Connected</title>
          <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f7fa}.card{background:white;padding:32px 40px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:400px}h1{margin:0 0 8px;color:#10b981}p{color:#475569;margin:8px 0}</style>
        </head>
        <body>
          <div class="card">
            <h1>✓ Connected</h1>
            <p>Google account <strong>${escapeHtml(email)}</strong> is now linked to Qflow.</p>
            <p>You can close this window and return to the Station.</p>
          </div>
          <script>setTimeout(()=>window.close(),2500)</script>
        </body>
      </html>
    `);
  } catch (err: any) {
    return htmlResponse(`<h1>Connection failed</h1><pre>${escapeHtml(err?.message || String(err))}</pre>`, 500);
  }
}

function htmlResponse(html: string, status = 200) {
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
