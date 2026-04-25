/**
 * Shared server-side helper: resolves a screen token to { officeId, organizationId }.
 * Used by all three KDS API routes so the lookup logic lives in one place.
 *
 * Resolution order (mirrors /display/[screenToken]/page.tsx):
 *   1. display_screens.screen_token (exact match, is_active=true)
 *   2. office public token (first 16 hex chars of office UUID without dashes)
 *
 * Returns null if the token cannot be resolved to an active office.
 */
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { matchesOfficePublicToken } from '@/lib/office-links';

export interface ResolvedScreen {
  officeId: string;
  organizationId: string;
}

export async function resolveKitchenScreenToken(
  screenToken: string,
): Promise<ResolvedScreen | null> {
  const supabase = createAdminClient();

  // 1. Try display_screens.screen_token
  const { data: screen } = await supabase
    .from('display_screens')
    .select('office_id')
    .eq('screen_token', screenToken)
    .eq('is_active', true)
    .maybeSingle();

  if (screen?.office_id) {
    const { data: office } = await supabase
      .from('offices')
      .select('id, organization_id')
      .eq('id', screen.office_id)
      .maybeSingle();
    if (office) {
      return { officeId: office.id, organizationId: office.organization_id };
    }
  }

  // 2. Fallback: office public token
  const { data: offices } = await supabase
    .from('offices')
    .select('id, organization_id')
    .eq('is_active', true);

  const office = offices?.find((o: any) => matchesOfficePublicToken(o, screenToken));
  if (office) {
    return { officeId: office.id, organizationId: office.organization_id };
  }

  return null;
}
