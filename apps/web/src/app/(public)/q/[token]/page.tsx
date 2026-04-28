import type { ReactNode } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { CheckInForm } from '@/components/queue/check-in-form';
import { QueueStatus } from '@/components/queue/queue-status';
import { GroupStatus } from '@/components/queue/group-status';
import OrderStatus from '@/components/queue/order-status';
import { getPriorityAlertConfig } from '@/lib/priority-alerts';
import { isSmsProviderConfigured } from '@/lib/sms';
import { getServerI18n } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { getCountryConfig, resolveLocale } from '@/lib/country';
import { resolveRestaurantServiceType } from '@qflo/shared';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function TicketStatusPage({ params }: PageProps) {
  const { t } = await getServerI18n();
  const { token } = await params;
  const supabase = createAdminClient();

  // Fetch ticket with related data
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('qr_token', token)
    .single();

  if (error || !ticket) {
    return renderWithLanguageSwitcher(
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-sm rounded-xl bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <svg
              className="h-8 w-8 text-destructive"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-foreground">
            {t('Ticket Not Found')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('This ticket link is invalid or has expired. Please check your QR code and try again.')}
          </p>
        </div>
      </div>
    );
  }

  // If ticket has a group_id, show the group status view
  if (ticket.group_id) {
    // Fetch office name for the group view
    const { data: groupOffice } = await supabase
      .from('offices')
      .select('name')
      .eq('id', ticket.office_id)
      .single();

    return (
      renderWithLanguageSwitcher(
        <GroupStatus
          groupId={ticket.group_id}
          currentTicketId={ticket.id}
          officeName={groupOffice?.name ?? t('Office')}
        />
      )
    );
  }

  // Fetch office info
  const { data: office } = await supabase
    .from('offices')
    .select('name, address, organization_id')
    .eq('id', ticket.office_id)
    .single();

  // Fetch organization info
  let organizationName = '';
  let priorityAlertConfig = null;
  let messengerPageId: string | null = null;
  let acceptsCash = false;
  let orgLocalePrimary: string | null = null;
  let orgCountry: string | null = null;
  if (office?.organization_id) {
    const { data: organization } = await (supabase as any)
      .from('organizations')
      .select('name, settings, accepts_cash, locale_primary, country')
      .eq('id', office.organization_id)
      .single() as { data: { name: string; settings: Record<string, any> | null; accepts_cash: boolean; locale_primary: string | null; country: string | null } | null };

    organizationName = organization?.name ?? '';
    acceptsCash = organization?.accepts_cash ?? false;
    orgLocalePrimary = organization?.locale_primary ?? null;
    orgCountry = organization?.country ?? null;
    const orgSettings = (organization?.settings as Record<string, any> | null) ?? null;
    priorityAlertConfig = getPriorityAlertConfig(orgSettings, isSmsProviderConfigured());
    if (orgSettings?.messenger_enabled && orgSettings?.messenger_page_id) {
      messengerPageId = orgSettings.messenger_page_id as string;
    }
  }

  // Fetch department info
  const { data: department } = await supabase
    .from('departments')
    .select('name')
    .eq('id', ticket.department_id)
    .single();

  // Fetch service info
  const { data: service } = await supabase
    .from('services')
    .select('name, description')
    .eq('id', ticket.service_id ?? '')
    .single();

  // Fetch desk info if assigned
  let desk: { name: string; display_name: string | null } | null = null;
  if (ticket.desk_id) {
    const { data } = await supabase
      .from('desks')
      .select('name, display_name')
      .eq('id', ticket.desk_id)
      .single();
    desk = data;
  }

  const contextInfo = {
    organizationName,
    officeName: office?.name ?? '',
    officeAddress: office?.address ?? '',
    departmentName: department?.name ?? '',
    serviceName: service?.name ?? '',
    serviceDescription: service?.description ?? '',
  };

  // Locale cascade — the customer's pick wins; otherwise respect the business's
  // Primary Locale, then country default, then 'en'.
  const customerPickedLocale = (ticket.customer_data as Record<string, unknown> | null)?.locale as string | undefined;
  const countryConfig = orgCountry ? await getCountryConfig(supabase as any, orgCountry).catch(() => null) : null;
  const ticketLocale: string = resolveLocale(customerPickedLocale, orgLocalePrimary, countryConfig);

  // ── Online restaurant orders get the delivery / takeout tracking UI ──
  // Filter: source = whatsapp / web (means customer ordered through the
  // public surface, not a walk-in) AND the resolved service type is
  // takeout or delivery. Anything else (queue tickets, dine-in, kiosk,
  // appointments) falls through to the existing QueueStatus component.
  const restaurantServiceType = resolveRestaurantServiceType(service?.name ?? '');
  const isOnlineOrder = ticket.source === 'whatsapp' || ticket.source === 'web';
  const isOrderTracking = isOnlineOrder
    && (restaurantServiceType === 'takeout' || restaurantServiceType === 'delivery');

  if (isOrderTracking) {
    // Pull items + assigned rider for the rich tracking page. Pricing is
    // server-rendered as a string so the locale/currency formatting is
    // consistent and the client component stays free of i18n money logic.
    const [{ data: itemRows }, riderResult] = await Promise.all([
      supabase
        .from('ticket_items')
        .select('id, name, qty, price, added_at')
        .eq('ticket_id', ticket.id)
        .order('added_at', { ascending: true }),
      ticket.assigned_rider_id
        ? supabase.from('staff').select('full_name, phone').eq('id', ticket.assigned_rider_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const items = (itemRows ?? []) as Array<{ id: string; name: string; qty: number; price: number | null }>;
    const currency: string = (typeof orgCountry === 'string' && orgCountry === 'DZ') ? 'DA' : 'DA';
    let total = 0;
    const renderedItems = items.map((it) => {
      const lineTotal = (it.price ?? 0) * (it.qty ?? 0);
      total += lineTotal;
      return {
        id: it.id,
        name: it.name,
        qty: it.qty,
        line_total: typeof it.price === 'number' ? `${lineTotal.toFixed(2)} ${currency}` : null,
      };
    });

    const itemCount = items.reduce((s, it) => s + (it.qty ?? 0), 0);
    const totalDisplay = items.length > 0 ? `${total.toFixed(2)} ${currency}` : null;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

    return renderWithLanguageSwitcher(
      <OrderStatus
        initialTicket={{
          id: ticket.id,
          ticket_number: ticket.ticket_number,
          status: ticket.status,
          qr_token: ticket.qr_token,
          created_at: ticket.created_at ?? null,
          completed_at: ticket.completed_at ?? null,
          // No `cancelled_at` column in cloud; cancelled state is derived
          // from status === 'cancelled' inside the client component.
          cancelled_at: null,
          dispatched_at: (ticket as any).dispatched_at ?? null,
          arrived_at: (ticket as any).arrived_at ?? null,
          delivered_at: (ticket as any).delivered_at ?? null,
          notes: ticket.notes ?? null,
          customer_data: (ticket.customer_data as Record<string, any>) ?? null,
          delivery_address: (ticket as any).delivery_address ?? null,
          assigned_rider_id: (ticket as any).assigned_rider_id ?? null,
        }}
        serviceMode={restaurantServiceType as 'takeout' | 'delivery'}
        locale={(ticketLocale.slice(0, 2) === 'ar' ? 'ar' : ticketLocale.slice(0, 2) === 'fr' ? 'fr' : 'en') as 'ar' | 'fr' | 'en'}
        organizationName={contextInfo.organizationName}
        officeName={contextInfo.officeName}
        totalDisplay={totalDisplay}
        itemCount={itemCount}
        items={renderedItems}
        rider={riderResult.data ? { full_name: (riderResult.data as any).full_name ?? null, phone: (riderResult.data as any).phone ?? null } : null}
        supabaseUrl={supabaseUrl}
        supabaseAnonKey={supabaseAnonKey}
      />,
    );
  }

  // Status: issued with no customer data -> show check-in form
  if (ticket.status === 'issued' && !ticket.customer_data) {
    return (
      renderWithLanguageSwitcher(
        <CheckInForm
        ticket={ticket}
        officeName={contextInfo.officeName}
        serviceName={contextInfo.serviceName}
        />
      )
    );
  }

  // Main customer journey: waiting, called, serving, served
  if (ticket.status === 'waiting' || ticket.status === 'called') {
    return (
      <QueueStatus
        ticket={ticket}
        organizationName={contextInfo.organizationName}
        officeName={contextInfo.officeName}
        departmentName={contextInfo.departmentName}
        serviceName={contextInfo.serviceName}
        priorityAlertConfig={priorityAlertConfig}
        messengerPageId={messengerPageId}
      />
    );
  }

  if (ticket.status === 'serving' || ticket.status === 'served') {
    return (
      renderWithLanguageSwitcher(
        <>
          <QueueStatus
            ticket={ticket}
            organizationName={contextInfo.organizationName}
            officeName={contextInfo.officeName}
            departmentName={contextInfo.departmentName}
            serviceName={contextInfo.serviceName}
            priorityAlertConfig={priorityAlertConfig}
            messengerPageId={messengerPageId}
          />
          {acceptsCash && (
            <div className="mx-auto mt-4 w-full max-w-sm px-4">
              <CashBadge locale={ticketLocale} />
            </div>
          )}
        </>
      )
    );
  }

  // Status: no_show, cancelled, transferred
  const statusConfig: Record<string, { title: string; description: string; icon: string }> = {
    no_show: {
      title: t('Missed Your Turn'),
      description:
        t('You were called but did not show up. Please visit the front desk if you still need service.'),
      icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    cancelled: {
      title: t('Ticket Cancelled'),
      description: t('This ticket has been cancelled. Please take a new ticket if you need service.'),
      icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    transferred: {
      title: t('Ticket Transferred'),
      description:
        t('Your ticket has been transferred to another service. Please check your new ticket.'),
      icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
    },
  };

  const config = statusConfig[ticket.status] ?? {
      title: t('Ticket Status'),
      description: t('Current status: {status}', { status: ticket.status }),
      icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  };

  return renderWithLanguageSwitcher(
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <div className="w-full max-w-sm text-center">
        <div className="rounded-xl bg-card p-8 shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
            <svg
              className="h-8 w-8 text-warning"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={config.icon}
              />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-foreground">{config.title}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{config.description}</p>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm font-medium text-muted-foreground">{t('Ticket Number')}</p>
            <p className="text-2xl font-bold text-foreground">{ticket.ticket_number}</p>
          </div>
        </div>
        {acceptsCash && (
          <div className="mt-4">
            <CashBadge locale={ticketLocale} />
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          {contextInfo.officeName} &middot; {contextInfo.serviceName}
        </p>
      </div>
    </div>
  );
}
function CashBadge({ locale }: { locale: string }) {
  const labels: Record<string, string> = {
    fr: 'Espèces acceptées',
    ar: 'يُقبل النقد',
    en: 'Cash accepted',
  };
  const label = labels[locale.slice(0, 2)] ?? labels.fr;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-center text-sm font-medium text-foreground">
      💵 {label}
    </div>
  );
}

  function renderWithLanguageSwitcher(content: ReactNode) {
    /*
     * Public ticket-tracking shell: language toggle bottom-left,
     * "Powered by Qflo" thin attribution at bottom-center. Both fixed
     * so they stay visible while the user scrolls a long order page,
     * and use safe-area inset padding so they don't collide with the
     * iOS home-indicator bar on iPhones. Bottom-left for the switcher
     * keeps it out of the thumb-tap path of the order's primary CTA
     * (Call driver, Pin, etc.) which lives in the upper-right zone.
     */
    return (
      <div className="relative">
        <div
          className="fixed bottom-3 left-3 z-[60] sm:bottom-4 sm:left-4"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {/* menuPlacement="top-left" → dropdown opens UPWARD and aligns
              left, so the locale options stay visible above the button
              instead of being clipped below the viewport. */}
          <LanguageSwitcher menuPlacement="top-left" />
        </div>
        {content}
        <div
          aria-hidden
          className="pointer-events-none fixed bottom-2 left-1/2 z-[55] -translate-x-1/2 select-none text-[10px] font-light tracking-wide text-muted-foreground/70"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          Powered by Qflo
        </div>
      </div>
    );
  }
