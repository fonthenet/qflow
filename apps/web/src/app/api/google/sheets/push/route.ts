import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAccessTokenForOrg, createSheet, writeSheetValues } from '@/lib/google-oauth';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const HEADERS = [
  'qflo_id', 'full_name', 'phone', 'email', 'gender', 'date_of_birth',
  'blood_type', 'file_number', 'address', 'wilaya_code', 'city',
  'is_couple', 'spouse_name', 'spouse_dob', 'spouse_blood_type', 'marriage_date',
  'notes', 'created_at',
];

/**
 * POST /api/google/sheets/push
 * Body: { organizationId: string, sheetTitle?: string }
 *
 * Pulls all customers for the org and writes them to the linked Google Sheet.
 * If no sheet is linked yet, creates one named `sheetTitle` (or "Qflow Customers").
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = body.organizationId as string;
    const desiredTitle = (body.sheetTitle as string) || 'Qflow Customers';
    if (!orgId) return NextResponse.json({ error: 'Missing organizationId' }, { status: 400, headers: CORS });

    const sb = createAdminClient() as any;

    // 1. Get access token (also validates connection exists)
    const accessToken = await getAccessTokenForOrg(orgId);

    // 2. Get or create the sheet link
    const { data: existingLink } = await sb
      .from('sheet_links')
      .select('id, sheet_id, sheet_name')
      .eq('organization_id', orgId)
      .maybeSingle();

    let sheetId: string;
    let sheetName: string;
    if (existingLink) {
      sheetId = existingLink.sheet_id;
      sheetName = existingLink.sheet_name || desiredTitle;
    } else {
      sheetId = await createSheet(accessToken, desiredTitle);
      sheetName = desiredTitle;
      await sb.from('sheet_links').insert({
        organization_id: orgId,
        sheet_id: sheetId,
        sheet_name: sheetName,
      });
    }

    // 3. Fetch all customers for the org
    const { data: customers, error: custErr } = await sb
      .from('customers')
      .select('id, full_name, phone, email, gender, date_of_birth, blood_type, file_number, address, wilaya_code, city, is_couple, spouse_name, spouse_dob, spouse_blood_type, marriage_date, notes, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (custErr) throw new Error(custErr.message);

    const rows: (string | number | null)[][] = [HEADERS];
    for (const c of customers || []) {
      rows.push([
        c.id,
        c.full_name ?? '',
        c.phone ?? '',
        c.email ?? '',
        c.gender ?? '',
        c.date_of_birth ?? '',
        c.blood_type ?? '',
        c.file_number ?? '',
        c.address ?? '',
        c.wilaya_code ?? '',
        c.city ?? '',
        c.is_couple ? 'true' : 'false',
        c.spouse_name ?? '',
        c.spouse_dob ?? '',
        c.spouse_blood_type ?? '',
        c.marriage_date ?? '',
        c.notes ?? '',
        c.created_at ?? '',
      ]);
    }

    // 4. Write to the sheet
    await writeSheetValues(accessToken, sheetId, rows);

    // 5. Update last_pushed_at
    await sb
      .from('sheet_links')
      .update({ last_pushed_at: new Date().toISOString(), last_row_count: (customers?.length ?? 0) })
      .eq('organization_id', orgId);

    return NextResponse.json(
      {
        ok: true,
        sheetId,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
        rowCount: customers?.length ?? 0,
      },
      { headers: CORS },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Push failed' }, { status: 500, headers: CORS });
  }
}
