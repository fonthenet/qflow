import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { resolveRestaurantServiceType, type OrderServiceMode } from '@qflo/shared';
import { MenuOrderForm } from './MenuOrderForm';

/**
 * Public restaurant ordering page.
 *
 *   /m/<officeSlug>?p=<phone>
 *
 * Customer flow:
 *   1. Picks Takeout / Delivery (only those the office has services for)
 *   2. Browses menu by category, taps + on items, sets qty
 *   3. Fills name + phone (pre-filled from `?p=` when launched from WhatsApp)
 *   4. For delivery, fills address
 *   5. Submits → POST /api/orders/place
 *   6. Server creates a `pending_approval` ticket; operator on Station
 *      Accept/Decline. WhatsApp confirmation flows back.
 *
 * No auth required. Reads ride on a public RLS policy that limits the menu
 * read to is_available=TRUE rows (see migration 20260428120000_*).
 */

export async function generateMetadata({ params }: { params: Promise<{ officeSlug: string }> }): Promise<Metadata> {
  const { officeSlug } = await params;
  const displayName = decodeURIComponent(officeSlug).replace(/-/g, ' ');
  return {
    title: `Order online — ${displayName} | Qflo`,
    description: `Order takeout or delivery from ${displayName}.`,
    openGraph: {
      title: `Order online — ${displayName}`,
      description: `Order takeout or delivery from ${displayName}.`,
      type: 'website',
    },
  };
}

interface PageProps {
  params: Promise<{ officeSlug: string }>;
  searchParams?: Promise<{ p?: string; service?: string }>;
}

export default async function PublicMenuPage({ params, searchParams }: PageProps) {
  const { officeSlug } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const supabase = createAdminClient();

  // 1. Resolve office by public slug (same pattern as /book/[officeSlug])
  const { data: offices } = await supabase
    .from('offices')
    .select('*')
    .eq('is_active', true);
  const office = offices?.find((entry) => matchesOfficePublicSlug(entry, officeSlug));
  if (!office) notFound();

  // 2. Resolve organization (currency, name, locale)
  const { data: organization } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', office.organization_id)
    .single();
  if (!organization) notFound();

  // 3. Determine which services this office offers — we map each service's
  //    name onto a restaurant service type and surface only takeout/delivery
  //    on this page. (Dine-in goes through /book/<slug>; surfacing it here
  //    would just route to a different flow and confuse customers.)
  const { data: departments } = await supabase
    .from('departments')
    .select('id, services(id, name, is_active)')
    .eq('office_id', office.id)
    .eq('is_active', true);

  type ServiceRow = { id: string; name: string; is_active: boolean };
  const allServices: ServiceRow[] = (departments ?? []).flatMap((d: any) =>
    (d.services ?? []).filter((s: ServiceRow) => s.is_active),
  );

  const offered = new Set<OrderServiceMode>();
  let takeoutServiceId: string | null = null;
  let deliveryServiceId: string | null = null;
  for (const s of allServices) {
    const t = resolveRestaurantServiceType(s.name);
    if (t === 'takeout' && !takeoutServiceId) {
      offered.add('takeout');
      takeoutServiceId = s.id;
    } else if (t === 'delivery' && !deliveryServiceId) {
      offered.add('delivery');
      deliveryServiceId = s.id;
    }
  }

  // No takeout or delivery services configured → operators haven't enabled
  // online ordering. Show a clean "not available" page (404 is fine here).
  if (offered.size === 0) notFound();

  // 4. Load menu — categories + available items, org-scoped.
  const orgId = office.organization_id;
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, sort_order')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('menu_items')
      .select('id, name, price, category_id, sort_order, prep_time_minutes, is_available, image_url')
      .eq('organization_id', orgId)
      .eq('is_available', true)
      .order('sort_order', { ascending: true }),
  ]);

  if (!categories?.length || !items?.length) {
    return (
      <main style={{ maxWidth: 480, margin: '40px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1>{office.name}</h1>
        <p style={{ color: '#64748b' }}>The online menu isn&apos;t ready yet. Please check back soon.</p>
      </main>
    );
  }

  // 5. Currency hint — country-derived; full mapping lives in shared.
  //    Defaults to "DA" since most current customers are in DZ.
  const orgSettings = (organization.settings ?? {}) as Record<string, any>;
  const currency: string = orgSettings.currency ?? 'DA';

  return (
    <MenuOrderForm
      office={{ id: office.id, slug: officeSlug, name: office.name }}
      organization={{ id: organization.id, name: organization.name, country: orgSettings.country ?? null }}
      offered={Array.from(offered)}
      categories={categories.map((c: any) => ({ id: c.id, name: c.name }))}
      items={items.map((it: any) => ({
        id: it.id,
        name: it.name,
        price: typeof it.price === 'number' ? it.price : Number(it.price ?? 0),
        category_id: it.category_id,
        prep_time_minutes: it.prep_time_minutes ?? null,
        image_url: it.image_url ?? null,
      }))}
      currency={currency}
      prefillPhone={sp?.p ?? ''}
      initialService={
        sp?.service === 'takeout' || sp?.service === 'delivery' ? sp.service : null
      }
    />
  );
}
