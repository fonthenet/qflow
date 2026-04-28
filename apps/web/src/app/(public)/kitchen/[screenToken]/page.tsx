/**
 * Web Kitchen Display System (KDS) — public token-gated page.
 *
 * Auth pattern: identical to /display/[screenToken] — no user login required.
 * A display screen token (or office public token as fallback) is the only
 * credential. We use createAdminClient() on the server so RLS is bypassed
 * only at this trusted server boundary; the client component receives a
 * pre-filtered, safe data snapshot.
 *
 * Vertical gate: if the resolved organization is NOT a restaurant/cafe we
 * render ServiceUnavailable rather than redirecting — redirect would require
 * knowing the display URL and creates an infinite-loop risk if both screens
 * share a token. A clear error message is simpler and operator-friendly.
 *
 * Initial data: server-fetches all tickets in status ('called', 'serving')
 * for the office that have at least one non-served item, ordered by
 * ticket_items.added_at ascending. The client component takes over with
 * realtime subscriptions + 8 s polling from there.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { matchesOfficePublicToken } from '@/lib/office-links';
import { ServiceUnavailable } from '@/components/service-unavailable';
import { KitchenDisplayBoard } from '@/components/kitchen/kitchen-display-board';
import type { KitchenTicket } from '@/components/kitchen/kitchen-display-board';
import { isRestaurantVertical } from '@qflo/shared';

interface KitchenPageProps {
  params: Promise<{ screenToken: string }>;
}

export default async function KitchenPage({ params }: KitchenPageProps) {
  const { screenToken } = await params;

  try {
    const supabase = createAdminClient();

    // ── 1. Resolve screen token → office (same logic as /display) ──────────
    let screen: any = null;
    let office: any = null;

    const { data: screenByToken } = await supabase
      .from('display_screens')
      .select('*')
      .eq('screen_token', screenToken)
      .eq('is_active', true)
      .maybeSingle();

    if (screenByToken) {
      screen = screenByToken;
      const { data: screenOffice } = await supabase
        .from('offices')
        .select('*, organization:organizations(*)')
        .eq('id', screen.office_id)
        .maybeSingle();
      office = screenOffice;
    } else {
      // Fallback: treat token as office public token (same as kiosk + display)
      const { data: offices } = await supabase
        .from('offices')
        .select('*, organization:organizations(*)')
        .eq('is_active', true);

      office = offices?.find((entry: any) => matchesOfficePublicToken(entry, screenToken));

      if (office) {
        const { data: defaultScreen } = await supabase
          .from('display_screens')
          .select('*')
          .eq('office_id', office.id)
          .eq('is_active', true)
          .order('created_at')
          .limit(1)
          .maybeSingle();

        screen = defaultScreen ?? {
          id: `virtual-${office.id}`,
          office_id: office.id,
          name: 'Kitchen',
          screen_token: screenToken,
          settings: {},
          is_active: true,
        };
      }
    }

    if (!screen || !office) notFound();

    // ── 2. Vertical gate ───────────────────────────────────────────────────
    const org = office.organization as any;
    const businessCategory: string | null =
      org?.business_category ??
      (org?.settings as any)?.business_category ??
      null;

    if (!isRestaurantVertical(businessCategory)) {
      return (
        <ServiceUnavailable
          title="Kitchen Display is not available"
          message="The Kitchen Display System is only available for restaurant and cafe accounts. Use the regular Display screen for this location."
          showRetry={false}
        />
      );
    }

    // ── 3. Resolve locale from org settings ───────────────────────────────
    const orgSettings = (org?.settings as Record<string, unknown>) ?? {};
    const rawLocale = (orgSettings.locale_primary ?? orgSettings.locale ?? 'fr') as string;
    const locale: 'fr' | 'ar' | 'en' =
      rawLocale === 'ar' ? 'ar' : rawLocale === 'en' ? 'en' : 'fr';

    // ── 4. Server-fetch initial active tickets with their kitchen items ─────
    // We fetch tickets in 'called' or 'serving' status, then fetch their
    // ticket_items separately (no office_id on ticket_items — join via ticket_id).
    const { data: activeTickets } = await supabase
      .from('tickets')
      .select(
        'id, ticket_number, status, customer_data, called_at, service_id, restaurant_tables!current_ticket_id(label)',
      )
      .eq('office_id', screen.office_id)
      .in('status', ['called', 'serving'])
      .order('called_at', { ascending: true });

    const ticketIds = (activeTickets ?? []).map((t: any) => t.id);

    // Resolve service names for the service-type pill on KDS cards.
    const serviceIds = [...new Set(
      (activeTickets ?? []).map((t: any) => t.service_id).filter(Boolean),
    )];
    const serviceNameById = new Map<string, string>();
    if (serviceIds.length > 0) {
      const { data: svcs } = await supabase
        .from('services')
        .select('id, name')
        .in('id', serviceIds);
      for (const svc of svcs ?? []) {
        if (svc.id && svc.name) serviceNameById.set(svc.id, svc.name);
      }
    }

    let itemsByTicket: Record<string, any[]> = {};
    if (ticketIds.length > 0) {
      const { data: items } = await supabase
        .from('ticket_items')
        .select('id, ticket_id, organization_id, name, qty, note, added_at, kitchen_status, kitchen_status_at')
        .in('ticket_id', ticketIds)
        .neq('kitchen_status', 'served')
        .order('added_at', { ascending: true });

      for (const item of items ?? []) {
        if (!itemsByTicket[item.ticket_id]) itemsByTicket[item.ticket_id] = [];
        itemsByTicket[item.ticket_id].push(item);
      }
    }

    // Build KitchenTicket[] — cards with at least one non-served item.
    const initialTickets: KitchenTicket[] = (activeTickets ?? [])
      .map((t: any) => {
        const items = itemsByTicket[t.id] ?? [];
        if (items.length === 0) return null;
        const customerData = t.customer_data as Record<string, unknown> | null ?? {};
        const tableLabel = Array.isArray(t.restaurant_tables)
          ? t.restaurant_tables[0]?.label ?? null
          : (t.restaurant_tables as any)?.label ?? null;
        return {
          ticket_id: t.id,
          ticket_number: t.ticket_number,
          table_label: tableLabel,
          party_size: (customerData?.party_size as string | number | null) ?? null,
          customer_name: (customerData?.name ?? customerData?.customer_name ?? null) as string | null,
          ticket_status: t.status,
          oldest_item_at: items[0]?.added_at ?? t.called_at ?? new Date().toISOString(),
          service_name: t.service_id ? (serviceNameById.get(t.service_id) ?? null) : null,
          items: items.map((it: any) => ({
            id: it.id,
            ticket_id: it.ticket_id,
            organization_id: it.organization_id,
            name: it.name,
            qty: it.qty,
            note: it.note ?? null,
            added_at: it.added_at,
            kitchen_status: (it.kitchen_status ?? 'new') as 'new' | 'in_progress' | 'ready' | 'served',
            kitchen_status_at: it.kitchen_status_at ?? null,
          })),
        } satisfies KitchenTicket;
      })
      .filter(Boolean) as KitchenTicket[];

    return (
      <KitchenDisplayBoard
        officeId={screen.office_id}
        organizationId={org?.id ?? ''}
        initialTickets={initialTickets}
        screenToken={screenToken}
        locale={locale}
      />
    );
  } catch (error) {
    console.error('[kitchen-page] error:', error);
    return (
      <ServiceUnavailable
        title="Kitchen Display temporarily unavailable"
        message="Unable to connect to the server. The display will automatically retry. If this persists, check the internet connection."
      />
    );
  }
}
