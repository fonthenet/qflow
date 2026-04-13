'use server';

import { getStaffContext } from '@/lib/authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone, resolveDialCode } from '@qflo/shared';

/**
 * Convert any phone input to local format (no country code).
 * "213669864728" → "0669864728", "+16612346622" → "6612346622"
 */
async function toLocalPhone(phone: string, orgId: string): Promise<string> {
  const trimmed = phone.trim();
  if (!trimmed) return trimmed;

  // Fetch org timezone for dial code context
  const supabase = createAdminClient();
  const { data: org } = await (supabase as any)
    .from('organizations')
    .select('timezone')
    .eq('id', orgId)
    .single();
  const tz = org?.timezone || 'Africa/Algiers';

  // Normalize to E.164 first
  const e164 = normalizePhone(trimmed, tz, null);
  if (!e164) return trimmed.replace(/\D/g, '');

  // Convert back to local format
  const dialCode = resolveDialCode(tz, null);
  if (dialCode && e164.startsWith(dialCode) && e164.length > dialCode.length + 6) {
    const subscriber = e164.slice(dialCode.length);
    return dialCode === '1' ? subscriber : '0' + subscriber;
  }
  // Fallback: well-known codes
  if (e164.startsWith('213') && e164.length === 12) return '0' + e164.slice(3);
  if (e164.startsWith('1') && e164.length === 11) return e164.slice(1);
  if (e164.startsWith('33') && e164.length === 11) return '0' + e164.slice(2);
  if (e164.startsWith('212') && e164.length === 12) return '0' + e164.slice(3);
  if (e164.startsWith('216') && e164.length === 11) return e164.slice(3);

  return trimmed.replace(/\D/g, '');
}

// ── CRUD ──────────────────────────────────────────────────────────────

export async function createCustomer(data: {
  name: string;
  phone: string;
  email?: string;
}) {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  // Fetch org timezone for phone normalization
  const { data: orgRow } = await (supabase as any)
    .from('organizations')
    .select('timezone')
    .eq('id', orgId)
    .single();
  const tz = orgRow?.timezone || 'Africa/Algiers';

  // Use unified upsert — deduplicates by phone, tracks name aliases
  const { upsertCustomerFromBooking } = await import('@/lib/upsert-customer');
  await upsertCustomerFromBooking(supabase, {
    organizationId: orgId,
    name: data.name.trim(),
    phone: data.phone.trim(),
    email: data.email?.trim() || null,
    source: 'manual',
    incrementVisit: false,
    timezone: tz,
  });

  // Fetch the customer record to return
  const localPhone = await toLocalPhone(data.phone, orgId);
  const { data: customer } = await (supabase as any)
    .from('customers')
    .select('*')
    .eq('organization_id', orgId)
    .ilike('phone', `%${localPhone.slice(-7)}%`)
    .order('visit_count', { ascending: false })
    .limit(1)
    .single();

  return { data: customer ?? null };
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
  if (data.phone !== undefined) updates.phone = await toLocalPhone(data.phone, orgId);
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

// ── Name aliases ──────────────────────────────────────────────────────

/** Remove a name from the customer's previous_names array */
export async function removeCustomerAlias(customerId: string, aliasToRemove: string) {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  const { data: customer } = await (supabase as any)
    .from('customers')
    .select('previous_names')
    .eq('id', customerId)
    .eq('organization_id', orgId)
    .single();

  if (!customer) return { error: 'Customer not found' };

  const prev: string[] = Array.isArray(customer.previous_names) ? customer.previous_names : [];
  const updated = prev.filter((n: string) => n !== aliasToRemove);

  const { error } = await (supabase as any)
    .from('customers')
    .update({ previous_names: updated })
    .eq('id', customerId)
    .eq('organization_id', orgId);

  if (error) return { error: error.message };
  return { data: updated };
}

/** Swap an alias to become the main name; current main name moves to aliases */
export async function setAliasAsMainName(customerId: string, alias: string) {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;
  const supabase = createAdminClient();

  const { data: customer } = await (supabase as any)
    .from('customers')
    .select('name, previous_names')
    .eq('id', customerId)
    .eq('organization_id', orgId)
    .single();

  if (!customer) return { error: 'Customer not found' };

  const currentName = (customer.name ?? '').trim();
  const prev: string[] = Array.isArray(customer.previous_names) ? customer.previous_names : [];

  // Remove the alias from the list, add current name in its place
  const updated = prev.filter((n: string) => n !== alias);
  if (currentName && currentName.toLowerCase() !== alias.toLowerCase()) {
    updated.push(currentName);
  }

  const { error } = await (supabase as any)
    .from('customers')
    .update({ name: alias, previous_names: updated })
    .eq('id', customerId)
    .eq('organization_id', orgId);

  if (error) return { error: error.message };
  return { data: { name: alias, previous_names: updated } };
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

  // Fetch org timezone once for phone normalization
  const { data: orgRow } = await (supabase as any)
    .from('organizations')
    .select('timezone')
    .eq('id', orgId)
    .single();
  const orgTz = orgRow?.timezone || 'Africa/Algiers';

  // Process in batches of 100
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const records = batch
      .filter((r) => r.phone?.trim())
      .map((r) => {
        const rawPhone = r.phone.trim();
        const e164 = normalizePhone(rawPhone, orgTz, null);
        let localPhone = rawPhone.replace(/\D/g, '');
        if (e164) {
          const dialCode = resolveDialCode(orgTz, null);
          if (dialCode && e164.startsWith(dialCode) && e164.length > dialCode.length + 6) {
            localPhone = dialCode === '1' ? e164.slice(dialCode.length) : '0' + e164.slice(dialCode.length);
          } else if (e164.startsWith('213') && e164.length === 12) { localPhone = '0' + e164.slice(3); }
          else if (e164.startsWith('1') && e164.length === 11) { localPhone = e164.slice(1); }
          else if (e164.startsWith('33') && e164.length === 11) { localPhone = '0' + e164.slice(2); }
          else if (e164.startsWith('212') && e164.length === 12) { localPhone = '0' + e164.slice(3); }
          else { localPhone = e164; }
        }
        return {
          organization_id: orgId,
          name: r.name?.trim() || null,
          phone: localPhone,
          email: r.email?.trim() || null,
          visit_count: 0,
          source: 'import',
        };
      });

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

/**
 * Import customers from a Google Sheets URL.
 * Accepts either a public sharing URL or the published-to-web CSV URL.
 * Auto-converts /edit URLs to the CSV export endpoint.
 */
export async function importFromGoogleSheets(
  url: string,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  try {
    let csvUrl = url.trim();

    // Convert /edit?usp=sharing or /edit#gid=0 to /export?format=csv
    const editMatch = csvUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (editMatch) {
      const sheetId = editMatch[1];
      const gidMatch = csvUrl.match(/[?#&]gid=(\d+)/);
      const gid = gidMatch ? gidMatch[1] : '0';
      csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    }

    const res = await fetch(csvUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return { imported: 0, skipped: 0, errors: [`Failed to fetch sheet: ${res.status}. Make sure the sheet is shared as "Anyone with the link can view".`] };
    }

    const text = await res.text();
    const rows = parseCsvText(text);
    if (rows.length === 0) {
      return { imported: 0, skipped: 0, errors: ['No data rows found in sheet'] };
    }

    return await importCustomers(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to import from Google Sheets';
    return { imported: 0, skipped: 0, errors: [message] };
  }
}

/**
 * Lightweight CSV parser with header auto-detection for name/phone/email columns.
 * Handles comma, semicolon, and tab delimiters; strips surrounding quotes.
 */
function parseCsvText(text: string): { name: string; phone: string; email?: string }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('name') || firstLine.includes('phone') || firstLine.includes('email');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  let nameIdx = 0,
    phoneIdx = 1,
    emailIdx = 2;
  if (hasHeader) {
    const headers = lines[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
    nameIdx = headers.findIndex((h) => h.includes('name'));
    phoneIdx = headers.findIndex((h) => h.includes('phone') || h.includes('tel') || h.includes('mobile'));
    emailIdx = headers.findIndex((h) => h.includes('email') || h.includes('mail'));
    if (nameIdx === -1) nameIdx = 0;
    if (phoneIdx === -1) phoneIdx = 1;
  }

  return dataLines
    .map((line) => {
      const cols = line.split(/[,;\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ''));
      return {
        name: cols[nameIdx] ?? '',
        phone: cols[phoneIdx] ?? '',
        email: emailIdx >= 0 ? cols[emailIdx] ?? '' : '',
      };
    })
    .filter((r) => r.phone);
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
