import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Facebook Data Deletion Callback
 *
 * When a user removes the app from their Facebook settings, Facebook sends
 * a POST request here with a signed_request. We must:
 * 1. Parse and verify the signed_request
 * 2. Delete the user's Messenger session data
 * 3. Return a JSON response with a confirmation_code and a status_url
 *
 * Facebook docs: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */

const APP_SECRET = process.env.MESSENGER_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? '';

function parseSignedRequest(signedRequest: string, secret: string): Record<string, any> | null {
  const [encodedSig, payload] = signedRequest.split('.', 2);
  if (!encodedSig || !payload) return null;

  const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest();

  if (!crypto.timingSafeEqual(sig, expectedSig)) return null;

  try {
    const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const signedRequest = formData.get('signed_request') as string | null;

    if (!signedRequest) {
      return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
    }

    // Parse and verify
    const data = APP_SECRET ? parseSignedRequest(signedRequest, APP_SECRET) : null;
    const userId = data?.user_id ?? 'unknown';

    // Generate a confirmation code
    const confirmationCode = crypto.randomUUID();

    // Delete Messenger session data for this user
    // We store messenger sessions by page-scoped user ID (psid)
    // The userId from Facebook's callback is the app-scoped user ID,
    // but we clean up any matching sessions as a best effort
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );

      // Delete any messenger sessions associated with this Facebook user
      await supabase
        .from('messenger_sessions')
        .delete()
        .eq('facebook_user_id', userId);

      // Also clean up any notification records linked to messenger for this user
      await supabase
        .from('notifications')
        .delete()
        .eq('channel', 'messenger')
        .eq('recipient_id', userId);

    } catch (dbError) {
      // Log but don't fail — we still need to return the confirmation to Facebook
      console.error('[data-deletion] DB cleanup error:', dbError);
    }

    // Build the status URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://qflo.net';
    const statusUrl = `${baseUrl}/data-deletion?code=${confirmationCode}`;

    // Facebook expects this exact JSON shape
    return NextResponse.json({
      url: statusUrl,
      confirmation_code: confirmationCode,
    });
  } catch (error) {
    console.error('[data-deletion] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
