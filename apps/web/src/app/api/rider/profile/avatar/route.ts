import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderSession } from '@/lib/rider-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'rider-avatars';
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * POST /api/rider/profile/avatar
 *   multipart/form-data with one field `file`.
 *   Auth: Bearer rider session token.
 *
 * Stores in Supabase Storage at `rider-avatars/<rider_id>/avatar.<ext>`,
 * upserts so subsequent uploads overwrite (no orphan files), updates
 * riders.avatar_url with a cache-busted public URL, and returns the
 * fresh URL.
 *
 * The Expo client should resize to ~512px before upload to keep
 * payloads small — server still caps at 2 MB defensively.
 */
export async function POST(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try { formData = await request.formData(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid form data' }, { status: 400 }); }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ ok: false, error: 'File must be PNG, JPEG or WebP' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ ok: false, error: 'File must be under 2 MB' }, { status: 400 });
  }

  const sb = createAdminClient() as any;

  // Lazy bucket creation — same pattern as /api/upload-logo. Public
  // bucket so the URL we save is directly fetchable from the app.
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === BUCKET);
    if (!exists) {
      await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_SIZE });
    }
  } catch (e: any) {
    if (!e?.message?.includes('already exists')) {
      console.error('[rider/avatar] bucket setup failed', e?.message);
    }
  }

  const ext = file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
    : 'jpg';
  const filePath = `${session.riderId}/avatar.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: file.type, upsert: true });
  if (uploadErr) {
    console.error('[rider/avatar] upload failed', uploadErr.message);
    return NextResponse.json({ ok: false, error: uploadErr.message }, { status: 500 });
  }

  const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(filePath);
  const publicUrl = urlData?.publicUrl;
  if (!publicUrl) {
    return NextResponse.json({ ok: false, error: 'Failed to get public URL' }, { status: 500 });
  }
  // Cache-buster so the device sees the new image immediately even
  // when the URL string didn't change (same path + upsert).
  const url = `${publicUrl}?v=${Date.now()}`;

  const { error: updErr } = await sb
    .from('riders')
    .update({ avatar_url: url })
    .eq('id', session.riderId);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url });
}

/**
 * DELETE /api/rider/profile/avatar
 *
 * Clears the rider's avatar — drops the column to NULL and removes
 * the stored object best-effort. Used by the "Remove photo" button.
 */
export async function DELETE(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const sb = createAdminClient() as any;
  await sb.from('riders').update({ avatar_url: null }).eq('id', session.riderId);

  // Best-effort cleanup — fire-and-forget. Storage always allows
  // overwriting an unknown path.
  for (const ext of ['png', 'jpg', 'webp']) {
    void sb.storage.from(BUCKET).remove([`${session.riderId}/avatar.${ext}`]).then(() => {}, () => {});
  }

  return NextResponse.json({ ok: true });
}
