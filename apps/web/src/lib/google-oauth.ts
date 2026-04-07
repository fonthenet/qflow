// Google OAuth + Sheets API helpers (server-side only).
import { createAdminClient } from '@/lib/supabase/admin';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export function getRedirectUri(): string {
  return `${process.env.NEXT_PUBLIC_SITE_URL || 'https://qflo.net'}/api/google/oauth/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch user info');
  const data = (await res.json()) as { email: string };
  return data.email;
}

/** Get a valid access token for the org, refreshing if needed. */
export async function getAccessTokenForOrg(orgId: string): Promise<string> {
  const sb = createAdminClient() as any;
  const { data: conn, error } = await sb
    .from('google_connections')
    .select('refresh_token, access_token, token_expires_at')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error || !conn) throw new Error('No Google connection for this organization');

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token && expiresAt - Date.now() > 60_000) {
    return conn.access_token;
  }
  const refreshed = await refreshAccessToken(conn.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await sb
    .from('google_connections')
    .update({ access_token: refreshed.access_token, token_expires_at: newExpiresAt })
    .eq('organization_id', orgId);
  return refreshed.access_token;
}

/** Create a new Google Sheet and return its ID. */
export async function createSheet(accessToken: string, title: string): Promise<string> {
  const res = await fetch(SHEETS_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: { title } }),
  });
  if (!res.ok) throw new Error(`Create sheet failed: ${await res.text()}`);
  const data = (await res.json()) as { spreadsheetId: string };
  return data.spreadsheetId;
}

/** Replace all values in Sheet1 of the given spreadsheet. */
export async function writeSheetValues(
  accessToken: string,
  sheetId: string,
  values: (string | number | null)[][],
): Promise<void> {
  // Clear first
  const clearRes = await fetch(`${SHEETS_BASE}/${sheetId}/values/Sheet1!A:Z:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!clearRes.ok) throw new Error(`Clear sheet failed: ${await clearRes.text()}`);

  const writeRes = await fetch(
    `${SHEETS_BASE}/${sheetId}/values/Sheet1!A1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    },
  );
  if (!writeRes.ok) throw new Error(`Write sheet failed: ${await writeRes.text()}`);
}
