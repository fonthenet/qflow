/**
 * Per-customer auto-approve lookup.
 *
 * When the org has `require_appointment_approval=true`, bookings normally
 * land in `pending` and wait for staff moderation. Each customer row can
 * opt into auto-confirm via `customers.auto_approve_reservations`. This
 * helper looks up the matching customer and returns whether that flag is
 * on, so booking paths can decide whether to override the approval gate.
 *
 * Matching: (organization_id, phone) with the same variant set used by
 * upsertCustomerFromBooking, so a customer stored in local format still
 * matches a booking submitted in E.164 and vice versa.
 *
 * Best-effort by design — any lookup failure returns `false` so the booking
 * simply follows the org-level setting.
 */
import { normalizePhone } from '@qflo/shared';

function toLocalPhone(e164: string): string {
  if (!e164) return e164;
  if (e164.startsWith('213') && e164.length === 12) return '0' + e164.slice(3);
  if (e164.startsWith('1') && e164.length === 11) return e164.slice(1);
  if (e164.startsWith('33') && e164.length === 11) return '0' + e164.slice(2);
  if (e164.startsWith('216') && e164.length === 11) return e164.slice(3);
  if (e164.startsWith('212') && e164.length === 12) return '0' + e164.slice(3);
  return e164;
}

function phoneVariants(rawPhone: string, e164: string, localPhone: string): string[] {
  const set = new Set<string>();
  if (rawPhone) set.add(rawPhone);
  if (e164) {
    set.add(e164);
    set.add('+' + e164);
  }
  if (localPhone) set.add(localPhone);
  return Array.from(set).filter(Boolean);
}

export async function isCustomerAutoApprove(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string | null | undefined,
  phone: string | null | undefined,
  timezone?: string | null,
): Promise<boolean> {
  try {
    if (!organizationId || !phone) return false;
    const rawPhone = String(phone).trim();
    if (!rawPhone) return false;

    const e164 = normalizePhone(rawPhone, timezone ?? null, null);
    if (!e164) return false;
    const localPhone = toLocalPhone(e164);
    const variants = phoneVariants(rawPhone, e164, localPhone);

    const { data, error } = await supabase
      .from('customers')
      .select('auto_approve_reservations')
      .eq('organization_id', organizationId)
      .in('phone', variants)
      .eq('auto_approve_reservations', true)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
