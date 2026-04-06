'use server';

import { getStaffContext } from '@/lib/authz';
import { createAdminClient } from '@/lib/supabase/admin';

// ── CRUD ──────────────────────────────────────────────────────────────

export async function createCustomer(data: {
  name: string;
  phone: string;
  email?: string;
}) {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  const { data: customer, error } = await (supabase as any)
    .from('customers')
    .insert({
      organization_id: orgId,
      name: data.name.trim(),
      phone: data.phone.trim(),
      email: data.email?.trim() || null,
      visit_count: 0,
      source: 'manual',
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { error: 'A customer with this phone number already exists.' };
    }
    return { error: error.message };
  }
  return { data: customer };
}

export async function updateCustomer(
  customerId: string,
  data: { name?: string; phone?: string; email?: string },
) {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.phone !== undefined) updates.phone = data.phone.trim();
  if (data.email !== undefined) updates.email = data.email.trim() || null;

  const { data: customer, error } = await (supabase as any)
    .from('customers')
    .update(updates)
    .eq('id', customerId)
    .eq('organization_id', orgId)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { error: 'A customer with this phone number already exists.' };
    }
    return { error: error.message };
  }
  return { data: customer };
}

export async function deleteCustomer(customerId: string) {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  const { error } = await (supabase as any)
    .from('customers')
    .delete()
    .eq('id', customerId)
    .eq('organization_id', orgId);

  if (error) return { error: error.message };
  return { success: true };
}

// ── Bulk import (CSV) ─────────────────────────────────────────────────

export async function importCustomers(
  rows: { name: string; phone: string; email?: string }[],
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Process in batches of 100
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const records = batch
      .filter((r) => r.phone?.trim())
      .map((r) => ({
        organization_id: orgId,
        name: r.name?.trim() || null,
        phone: r.phone.trim(),
        email: r.email?.trim() || null,
        visit_count: 0,
        source: 'import',
      }));

    if (records.length === 0) continue;

    const { data, error } = await (supabase as any)
      .from('customers')
      .upsert(records, {
        onConflict: 'organization_id,phone',
        ignoreDuplicates: false,
      })
      .select('id');

    if (error) {
      errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      skipped += records.length;
    } else {
      imported += data?.length ?? 0;
      skipped += records.length - (data?.length ?? 0);
    }
  }

  return { imported, skipped, errors };
}

// ── Group messaging ───────────────────────────────────────────────────

export async function getCustomersForMessaging(filters?: {
  officeId?: string;
  minVisits?: number;
  lastVisitAfter?: string;
  search?: string;
}): Promise<{ data: { id: string; name: string | null; phone: string | null; email: string | null; visit_count: number }[]; error?: string }> {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  let query = (supabase as any)
    .from('customers')
    .select('id, name, phone, email, visit_count')
    .eq('organization_id', orgId)
    .order('name');

  if (filters?.minVisits) {
    query = query.gte('visit_count', filters.minVisits);
  }
  if (filters?.lastVisitAfter) {
    query = query.gte('last_visit_at', filters.lastVisitAfter);
  }
  if (filters?.search) {
    const q = filters.search.trim();
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  }

  // If officeId filter, get customers who have tickets for that office
  if (filters?.officeId) {
    const { data: ticketCustomers } = await (supabase as any)
      .from('tickets')
      .select('customer_id')
      .eq('office_id', filters.officeId)
      .not('customer_id', 'is', null);

    const customerIds = [...new Set((ticketCustomers ?? []).map((t: any) => t.customer_id))];
    if (customerIds.length > 0) {
      query = query.in('id', customerIds);
    } else {
      return { data: [] };
    }
  }

  const { data, error } = await query.limit(1000);
  if (error) return { data: [], error: error.message };
  return { data: data ?? [] };
}

export async function sendGroupMessage(data: {
  customerIds: string[];
  message: string;
  channel: 'whatsapp' | 'email';
}): Promise<{ sent: number; failed: number; error?: string }> {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  // Fetch selected customers
  const { data: customers, error } = await (supabase as any)
    .from('customers')
    .select('id, name, phone, email')
    .eq('organization_id', orgId)
    .in('id', data.customerIds);

  if (error) return { sent: 0, failed: 0, error: error.message };

  if (data.channel === 'whatsapp') {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp');

    let sent = 0;
    let failed = 0;

    for (const customer of customers ?? []) {
      if (!customer.phone) {
        failed++;
        continue;
      }

      try {
        const personalMessage = data.message.replace(/\{name\}/g, customer.name || '');
        const result = await sendWhatsAppMessage({
          to: customer.phone,
          body: personalMessage,
        });
        if (result.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }

      // Throttle to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return { sent, failed };
  }

  // Email channel — placeholder for future implementation
  return { sent: 0, failed: 0, error: 'Email sending not yet configured' };
}
