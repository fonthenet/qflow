import { toWilayaCode } from '@/lib/wilayas';
import { normalizePhone, resolveDialCode } from '@qflo/shared';

/**
 * Convert an E.164 phone (no +) back to local format:
 *   "213669864728" → "0669864728"
 *   "16612346622"  → "6612346622"
 *   "33612345678"  → "0612345678"
 *
 * Uses the business timezone to determine which country code to strip.
 * Falls back to well-known prefix detection.
 */
function toLocalPhone(e164: string, timezone?: string | null): string {
  if (!e164) return e164;

  const dialCode = resolveDialCode(timezone, null);

  // If we know the business's dial code and the number starts with it, strip it
  if (dialCode && e164.startsWith(dialCode) && e164.length > dialCode.length + 6) {
    const subscriber = e164.slice(dialCode.length);
    // Most countries use leading 0 for local dialing (Algeria, France, etc.)
    // US/Canada (dial code "1") does NOT use leading 0
    if (dialCode === '1') return subscriber;
    return '0' + subscriber;
  }

  // Fallback: detect well-known country codes
  // Algeria (213)
  if (e164.startsWith('213') && e164.length === 12) {
    return '0' + e164.slice(3);
  }
  // US/Canada (1)
  if (e164.startsWith('1') && e164.length === 11) {
    return e164.slice(1);
  }
  // France (33)
  if (e164.startsWith('33') && e164.length === 11) {
    return '0' + e164.slice(2);
  }
  // Tunisia (216)
  if (e164.startsWith('216') && e164.length === 11) {
    return e164.slice(3);
  }
  // Morocco (212)
  if (e164.startsWith('212') && e164.length === 12) {
    return '0' + e164.slice(3);
  }

  return e164; // can't determine — store as-is
}

/**
 * Build all phone variants to search for when looking up a customer.
 * Handles records stored in any format (local, E.164, subscriber-only).
 */
function phoneVariants(rawPhone: string, e164: string, localPhone: string): string[] {
  const variants = new Set<string>();
  variants.add(e164);
  variants.add(localPhone);

  // Also try the raw input (trimmed digits only)
  const trimmed = rawPhone.replace(/[^\d]/g, '');
  if (trimmed) variants.add(trimmed);

  // For Algerian numbers: try all formats
  if (e164.startsWith('213') && e164.length === 12) {
    variants.add('0' + e164.slice(3)); // 0XXXXXXXXX
    variants.add(e164.slice(3));       // XXXXXXXXX (subscriber only)
  }

  // For US/Canada numbers: try without country code
  if (e164.startsWith('1') && e164.length === 11) {
    variants.add(e164.slice(1)); // 10-digit
  }

  // For French numbers
  if (e164.startsWith('33') && e164.length === 11) {
    variants.add('0' + e164.slice(2));
    variants.add(e164.slice(2));
  }

  return [...variants];
}

/**
 * Auto-upsert a customer record from any booking flow (web form, WhatsApp,
 * Messenger, Station in-house, etc.). Bumps visit_count and refreshes
 * last_visit_at. Uses (organization_id, phone) as the natural key.
 *
 * Phone numbers are always stored in LOCAL format (no country code):
 *   - Algeria: "0669864728"  (not "213669864728")
 *   - US:      "6612346622"  (not "16612346622")
 *
 * Lookup uses variant matching across all formats to find existing records
 * regardless of how they were originally stored, then normalizes to local.
 *
 * Accepts any Supabase client that already has service-role or
 * appropriately-scoped permissions. Never throws — failures are logged
 * and swallowed so they don't break the booking flow.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertCustomerFromBooking(
  supabase: any,
  input: {
    organizationId: string;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    wilayaCode?: string | null;
    source?: string; // e.g. 'whatsapp', 'web', 'station', 'messenger'
    incrementVisit?: boolean; // default true
    timezone?: string | null; // e.g. 'Africa/Algiers' — helps normalize local phone formats
  },
): Promise<void> {
  try {
    const orgId = input.organizationId;
    const rawPhone = (input.phone ?? '').trim();
    if (!orgId || !rawPhone) return; // need both to dedupe

    // Normalize to E.164 for variant matching
    const e164 = normalizePhone(rawPhone, input.timezone, null);
    if (!e164) return;

    // Convert to local format for storage (no country code)
    const localPhone = toLocalPhone(e164, input.timezone);

    const name = (input.name ?? '').trim() || null;
    const email = (input.email ?? '').trim() || null;
    const notes = (input.notes ?? '').trim() || null;
    const wilayaCode = toWilayaCode(input.wilayaCode) || (input.wilayaCode ?? '').trim() || null;
    const nowIso = new Date().toISOString();
    const incrementVisit = input.incrementVisit !== false;

    // Look up by all phone variants (handles records in any format)
    const variants = phoneVariants(rawPhone, e164, localPhone);
    const { data: matches } = await supabase
      .from('customers')
      .select('id, name, email, notes, visit_count, wilaya_code, phone, previous_names')
      .eq('organization_id', orgId)
      .in('phone', variants)
      .order('visit_count', { ascending: false })
      .limit(5);

    if (matches && matches.length > 0) {
      // Pick the record with highest visit_count as the primary
      const primary = matches[0];
      const updates: Record<string, unknown> = {
        last_visit_at: nowIso,
        phone: localPhone, // always store local format
      };
      if (incrementVisit) updates.visit_count = (primary.visit_count || 0) + 1;
      // Name alias tracking: if the new name differs from stored name,
      // push the old name into previous_names and use the latest name.
      if (name) {
        const currentName = (primary.name ?? '').trim();
        if (!currentName) {
          // No existing name — just set it
          updates.name = name;
        } else if (currentName.toLowerCase() !== name.toLowerCase()) {
          // Name changed — archive old name, use new one
          const prev: string[] = Array.isArray(primary.previous_names) ? primary.previous_names : [];
          // Only add if not already in the alias list (case-insensitive)
          if (!prev.some((p: string) => p.toLowerCase() === currentName.toLowerCase())) {
            updates.previous_names = [...prev, currentName];
          }
          updates.name = name;
        }
      }
      if (email && !primary.email) updates.email = email;
      if (notes && !primary.notes) updates.notes = notes;
      if (wilayaCode) updates.wilaya_code = wilayaCode;
      await supabase.from('customers').update(updates).eq('id', primary.id);

      // Merge duplicates: move visits from secondary records to primary, then delete them
      if (matches.length > 1) {
        const dupeIds = matches.slice(1).map((m: any) => m.id);
        const extraVisits = matches.slice(1).reduce((sum: number, m: any) => sum + (m.visit_count || 0), 0);
        if (extraVisits > 0) {
          await supabase.from('customers')
            .update({ visit_count: (primary.visit_count || 0) + (incrementVisit ? 1 : 0) + extraVisits })
            .eq('id', primary.id);
        }
        await supabase.from('customers').delete().in('id', dupeIds);
      }
      return;
    }

    // Insert new with local phone format
    await supabase.from('customers').insert({
      organization_id: orgId,
      name,
      phone: localPhone,
      email,
      notes,
      wilaya_code: wilayaCode,
      visit_count: incrementVisit ? 1 : 0,
      last_visit_at: nowIso,
      source: input.source ?? 'booking',
    });
  } catch (err) {
    console.warn('[upsertCustomerFromBooking] failed (non-fatal):', (err as any)?.message ?? err);
  }
}
