// google-sheets-sync: scheduled edge function that pushes customers to Google
// Sheets for every org with auto_sync=true.
//
// Invoked by pg_cron every 15 minutes (see migration 20260417120000_google_sheets_sync.sql).
// Also invokable manually via POST /functions/v1/google-sheets-sync with
// `{ organizationId: "..." }` to force a single-org retry.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// Sync if last push is older than this (pg_cron runs every 15 min → use 10 min
// so we don't skip a tick because of a few seconds drift).
const STALE_MS = 10 * 60 * 1000;

const HEADERS = [
  "qflo_id", "name", "phone", "email", "gender", "date_of_birth",
  "blood_type", "file_number", "address", "wilaya_code", "city",
  "is_couple", "spouse_name", "spouse_dob", "spouse_blood_type", "marriage_date",
  "notes", "created_at",
];

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Google helpers ─────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

async function getAccessTokenForOrg(orgId: string): Promise<string> {
  const { data: conn, error } = await sb
    .from("google_connections")
    .select("refresh_token, access_token, token_expires_at")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error || !conn) throw new Error("No Google connection for this organization");

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token && expiresAt - Date.now() > 60_000) {
    return conn.access_token;
  }
  const { accessToken, expiresIn } = await refreshAccessToken(conn.refresh_token);
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await sb
    .from("google_connections")
    .update({ access_token: accessToken, token_expires_at: newExpiresAt })
    .eq("organization_id", orgId);
  return accessToken;
}

async function writeSheetValues(
  accessToken: string,
  sheetId: string,
  values: (string | number | null)[][],
): Promise<void> {
  const clearRes = await fetch(`${SHEETS_BASE}/${sheetId}/values/Sheet1!A:Z:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!clearRes.ok) throw new Error(`Clear sheet failed: ${await clearRes.text()}`);

  const writeRes = await fetch(
    `${SHEETS_BASE}/${sheetId}/values/Sheet1!A1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    },
  );
  if (!writeRes.ok) throw new Error(`Write sheet failed: ${await writeRes.text()}`);
}

// ── Per-org push ───────────────────────────────────────────────────────────

async function pushOrg(orgId: string, sheetId: string): Promise<{ rowCount: number }> {
  const accessToken = await getAccessTokenForOrg(orgId);

  const { data: customers, error: custErr } = await sb
    .from("customers")
    .select("id, name, phone, email, gender, date_of_birth, blood_type, file_number, address, wilaya_code, city, is_couple, spouse_name, spouse_dob, spouse_blood_type, marriage_date, notes, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (custErr) throw new Error(custErr.message);

  const rows: (string | number | null)[][] = [HEADERS];
  for (const c of customers || []) {
    rows.push([
      c.id, c.name ?? "", c.phone ?? "", c.email ?? "", c.gender ?? "",
      c.date_of_birth ?? "", c.blood_type ?? "", c.file_number ?? "", c.address ?? "",
      c.wilaya_code ?? "", c.city ?? "", c.is_couple ? "true" : "false",
      c.spouse_name ?? "", c.spouse_dob ?? "", c.spouse_blood_type ?? "",
      c.marriage_date ?? "", c.notes ?? "", c.created_at ?? "",
    ]);
  }

  await writeSheetValues(accessToken, sheetId, rows);
  return { rowCount: customers?.length ?? 0 };
}

async function syncOne(orgId: string, sheetId: string): Promise<{ ok: boolean; rowCount?: number; error?: string }> {
  try {
    const { rowCount } = await pushOrg(orgId, sheetId);
    const now = new Date().toISOString();
    await sb
      .from("sheet_links")
      .update({
        last_pushed_at: now,
        last_row_count: rowCount,
        last_success_at: now,
        last_error: null,
        last_error_at: null,
      })
      .eq("organization_id", orgId);
    return { ok: true, rowCount };
  } catch (e: any) {
    const msg = (e?.message || String(e)).slice(0, 500);
    await sb
      .from("sheet_links")
      .update({ last_error: msg, last_error_at: new Date().toISOString() })
      .eq("organization_id", orgId);
    console.error(`[google-sheets-sync] org=${orgId} failed:`, msg);
    return { ok: false, error: msg };
  }
}

// ── Entrypoint ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    // Manual single-org retry
    let targetOrgId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.organizationId) targetOrgId = String(body.organizationId);
      } catch { /* empty body — treat as scheduled run */ }
    }

    if (targetOrgId) {
      const { data: link } = await sb
        .from("sheet_links")
        .select("sheet_id")
        .eq("organization_id", targetOrgId)
        .maybeSingle();
      if (!link?.sheet_id) {
        return new Response(JSON.stringify({ error: "No sheet linked" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const result = await syncOne(targetOrgId, link.sheet_id);
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }

    // Scheduled run: sync every org whose auto_sync is on AND is stale.
    const threshold = new Date(Date.now() - STALE_MS).toISOString();
    const { data: links, error } = await sb
      .from("sheet_links")
      .select("organization_id, sheet_id, last_pushed_at")
      .eq("auto_sync", true);
    if (error) throw new Error(error.message);

    const stale = (links || []).filter(
      (l: any) => !l.last_pushed_at || l.last_pushed_at < threshold,
    );

    let ok = 0, failed = 0;
    for (const link of stale) {
      const r = await syncOne(link.organization_id, link.sheet_id);
      if (r.ok) ok++; else failed++;
    }

    return new Response(
      JSON.stringify({ ok: true, processed: stale.length, succeeded: ok, failed }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[google-sheets-sync] fatal:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
