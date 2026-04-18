import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const BUCKET = 'logos';

/**
 * POST /api/upload-logo
 * Multipart form: file (image), organizationId (string)
 * Auth: Bearer token (Supabase JWT)
 * Returns: { url: string } — the public URL of the uploaded logo
 */
export async function POST(request: NextRequest) {
  // ── Auth ──
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse form data ──
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const organizationId = formData.get('organizationId') as string | null;

  if (!file || !organizationId) {
    return NextResponse.json({ error: 'file and organizationId are required' }, { status: 400 });
  }

  // ── Validate file ──
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'File must be PNG, JPEG, WebP, or SVG' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File must be under 2 MB' }, { status: 400 });
  }

  // ── Verify user belongs to this organization ──
  const sb = createAdminClient() as any;
  const { data: membership } = await sb
    .from('organization_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId)
    .maybeSingle();

  // Allow owner/admin plus manager-tier station roles (admin, manager, branch_admin).
  // Desk operators and other limited roles cannot change branding.
  const ALLOWED_ROLES = ['owner', 'admin', 'manager', 'branch_admin'];
  if (!membership || !ALLOWED_ROLES.includes(membership.role)) {
    return NextResponse.json({ error: 'Forbidden — manager role or higher required' }, { status: 403 });
  }

  // ── Ensure storage bucket exists ──
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === BUCKET);
    if (!exists) {
      await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_SIZE });
    }
  } catch (e: any) {
    // Bucket may already exist — ignore "already exists" errors
    if (!e?.message?.includes('already exists')) {
      console.error('[upload-logo] bucket creation error:', e);
    }
  }

  // ── Upload to Supabase Storage ──
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const filePath = `${organizationId}/logo.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Upsert: overwrite previous logo
  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(filePath, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadErr) {
    console.error('[upload-logo] upload error:', uploadErr);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  // ── Get public URL ──
  const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(filePath);
  const publicUrl = urlData?.publicUrl;

  if (!publicUrl) {
    return NextResponse.json({ error: 'Failed to get public URL' }, { status: 500 });
  }

  // Add cache-buster to prevent stale logos
  const url = `${publicUrl}?v=${Date.now()}`;

  // ── Update organization logo_url ──
  await sb.from('organizations').update({ logo_url: url }).eq('id', organizationId);

  return NextResponse.json({ url });
}
