/**
 * Auto-upsert a customer record from any booking flow (web form, WhatsApp,
 * Messenger, Station in-house, etc.). Bumps visit_count and refreshes
 * last_visit_at. Uses (organization_id, phone) as the natural key.
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
    source?: string; // e.g. 'whatsapp', 'web', 'station', 'messenger'
    incrementVisit?: boolean; // default true
  },
): Promise<void> {
  try {
    const orgId = input.organizationId;
    const phone = (input.phone ?? '').trim();
    if (!orgId || !phone) return; // need both to dedupe

    const name = (input.name ?? '').trim() || null;
    const email = (input.email ?? '').trim() || null;
    const notes = (input.notes ?? '').trim() || null;
    const nowIso = new Date().toISOString();
    const incrementVisit = input.incrementVisit !== false;

    // Check existing
    const { data: existing } = await supabase
      .from('customers')
      .select('id, name, email, notes, visit_count')
      .eq('organization_id', orgId)
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const updates: Record<string, unknown> = { last_visit_at: nowIso };
      if (incrementVisit) updates.visit_count = (existing.visit_count || 0) + 1;
      // Only fill in missing fields, don't overwrite good data
      if (name && !existing.name) updates.name = name;
      if (email && !existing.email) updates.email = email;
      if (notes && !existing.notes) updates.notes = notes;
      await supabase.from('customers').update(updates).eq('id', existing.id);
      return;
    }

    // Insert new
    await supabase.from('customers').insert({
      organization_id: orgId,
      name,
      phone,
      email,
      notes,
      visit_count: incrementVisit ? 1 : 0,
      last_visit_at: nowIso,
      source: input.source ?? 'booking',
    });
  } catch (err) {
    console.warn('[upsertCustomerFromBooking] failed (non-fatal):', (err as any)?.message ?? err);
  }
}
