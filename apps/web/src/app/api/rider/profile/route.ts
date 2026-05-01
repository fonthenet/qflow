import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderSession } from '@/lib/rider-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * PATCH /api/rider/profile
 *   body: { name?: string, avatar_url?: string | null }
 *
 * The rider edits their own display name and avatar. Both fields
 * are optional — pass only what you want to change. Pass
 * `avatar_url: null` to clear the photo.
 *
 * Name validation matches the riders.name CHECK constraint:
 * non-empty after trim. Avatar must be an https URL we control or
 * a known CDN — we won't accept arbitrary URLs.
 */

const NAME_MAX = 60;
const ALLOWED_AVATAR_HOSTS = new Set([
  // Supabase Storage CDN
  'ofyyzuocifigyyhqxxqw.supabase.co',
  // Future-proofing — leave room for any CDN we wire in
]);

function sanitizeAvatarUrl(input: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'avatar_url must be a string or null' };
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return { ok: false, error: 'Invalid avatar URL' }; }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'Avatar URL must be https' };
  if (!ALLOWED_AVATAR_HOSTS.has(parsed.hostname)) {
    return { ok: false, error: 'Avatar host not allowed' };
  }
  return { ok: true, value: parsed.toString() };
}

export async function PATCH(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { name?: unknown; avatar_url?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const update: Record<string, any> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return NextResponse.json({ ok: false, error: 'name must be a string' }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ ok: false, error: 'Name cannot be empty' }, { status: 400 });
    }
    if (trimmed.length > NAME_MAX) {
      return NextResponse.json({ ok: false, error: `Name too long (max ${NAME_MAX})` }, { status: 400 });
    }
    update.name = trimmed;
  }

  if (body.avatar_url !== undefined) {
    const r = sanitizeAvatarUrl(body.avatar_url);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    update.avatar_url = r.value;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = createAdminClient() as any;
  const { data: rider, error } = await supabase
    .from('riders')
    .update(update)
    .eq('id', session.riderId)
    .select('id, name, phone, avatar_url, organization_id')
    .single();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rider });
}
