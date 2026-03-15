import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getTrimmedEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function encodeAPNsTarget(kind: unknown, environment: unknown, bundleId: unknown): string {
  const normalizedKind = kind === 'liveactivity' ? 'liveactivity' : 'alert';
  const normalizedEnvironment = environment === 'sandbox' ? 'sandbox' : 'production';
  const defaultBundleId = getTrimmedEnv('APNS_BUNDLE_ID') || 'com.queueflow.app.QueueFlowClip';
  const normalizedBundleId =
    typeof bundleId === 'string' && bundleId.trim().length > 0
      ? bundleId.trim()
      : defaultBundleId;

  return normalizedBundleId
    ? `${normalizedKind}|${normalizedEnvironment}|${normalizedBundleId}`
    : `${normalizedKind}|${normalizedEnvironment}`;
}

function parseAPNsKind(rawTarget: string | null): 'alert' | 'liveactivity' {
  if (!rawTarget) {
    return 'alert';
  }

  const [firstPart] = rawTarget.split('|', 1);
  return firstPart === 'liveactivity' ? 'liveactivity' : 'alert';
}

/**
 * POST /api/apns-register
 * Registers an APNs device token for a ticket.
 * Called by the iOS App Clip after it gets a push token.
 * No auth required — App Clip users are anonymous.
 */
export async function POST(request: NextRequest) {
  try {
    const { ticketId, deviceToken, kind, environment, bundleId } = await request.json();

    if (!ticketId || !deviceToken) {
      return NextResponse.json(
        { error: 'ticketId and deviceToken are required' },
        { status: 400 }
      );
    }

    const supabaseUrl = getTrimmedEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey =
      getTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY') ||
      getTrimmedEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const normalizedKind = kind === 'liveactivity' ? 'liveactivity' : 'alert';

    const { data: existingTokens, error: existingError } = await supabase
      .from('apns_tokens')
      .select('id, environment')
      .eq('ticket_id', ticketId);

    if (existingError) {
      console.error('[APNs Register] Failed to fetch existing tokens:', existingError);
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const tokenIdsToReplace =
      existingTokens
        ?.filter((token) => parseAPNsKind(token.environment) === normalizedKind)
        .map((token) => token.id) ?? [];

    if (tokenIdsToReplace.length > 0) {
      const { error: deleteError } = await supabase
        .from('apns_tokens')
        .delete()
        .in('id', tokenIdsToReplace);

      if (deleteError) {
        console.error('[APNs Register] Failed to replace existing token:', deleteError);
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }
    }

    // Insert new token
    const { error } = await supabase
      .from('apns_tokens')
      .insert({
        ticket_id: ticketId,
        device_token: deviceToken,
        environment: encodeAPNsTarget(normalizedKind, environment, bundleId),
      });

    if (error) {
      console.error('[APNs Register] Insert failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[APNs Register] Token saved for ticket:', ticketId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[APNs Register] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
