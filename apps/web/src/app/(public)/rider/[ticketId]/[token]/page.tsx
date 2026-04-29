import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';
import { RiderPortal } from '@/components/rider/rider-portal';

/**
 * Rider portal — opened by the driver on their phone after the operator
 * dispatches a delivery from Station and shares the link via WhatsApp.
 *
 *   /rider/<ticketId>/<token>
 *
 * Token is HMAC(ticketId, INTERNAL_WEBHOOK_SECRET). Stateless, no DB row.
 * Anyone with the link can act as the rider for that ticket — same threat
 * model as the kitchen screen token. Operator rotates the secret to
 * invalidate every outstanding link.
 *
 * Page server-renders the order summary (customer + address + Maps link)
 * and hands off to a client component that:
 *   - asks for browser geolocation permission once
 *   - posts heartbeats to /api/rider/heartbeat every ~12 s
 *   - exposes Arrived + Delivered buttons
 *   - auto-stops streaming when the ticket transitions to served
 */

interface PageProps {
  params: Promise<{ ticketId: string; token: string }>;
}

export const metadata: Metadata = {
  title: 'Driver portal — Qflo',
  description: 'Live delivery handoff for Qflo drivers.',
  // Don't index — every URL is a stand-alone token credential.
  robots: { index: false, follow: false },
};

export default async function RiderPortalPage({ params }: PageProps) {
  const { ticketId, token } = await params;
  if (!verifyRiderToken(ticketId, token)) {
    notFound();
  }

  const supabase = createAdminClient();
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, customer_data, delivery_address, office_id, dispatched_at, arrived_at, delivered_at')
    .eq('id', ticketId)
    .maybeSingle();
  if (!ticket) notFound();

  const { data: office } = await supabase
    .from('offices').select('name, organization_id').eq('id', ticket.office_id).maybeSingle();

  let orgName = '';
  if (office?.organization_id) {
    const { data: org } = await supabase
      .from('organizations').select('name').eq('id', office.organization_id).maybeSingle();
    orgName = org?.name ?? '';
  }

  const customerData = (ticket.customer_data ?? {}) as Record<string, any>;
  const customerName = typeof customerData.name === 'string' ? customerData.name : '';
  const customerPhone = typeof customerData.phone === 'string' ? customerData.phone : '';

  const da = ticket.delivery_address as Record<string, any> | null;
  const lat = typeof da?.lat === 'number' ? da.lat : null;
  const lng = typeof da?.lng === 'number' ? da.lng : null;

  // Pass the public Supabase creds so the rider portal can subscribe
  // to ticket UPDATEs via Realtime — the operator on Station may
  // mark Arrived / Delivered / Cancel from their side, and the rider
  // needs to see that flip live without refreshing. RLS already
  // allows anon SELECT on tickets (the customer tracking page uses
  // the same access pattern), so anon-key + ticket id is enough.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  return (
    <RiderPortal
      ticketId={ticket.id}
      ticketNumber={ticket.ticket_number}
      token={token}
      orgName={orgName}
      officeName={office?.name ?? ''}
      customerName={customerName}
      customerPhone={customerPhone}
      address={da?.street ?? null}
      addressCity={da?.city ?? null}
      addressInstructions={da?.instructions ?? null}
      destLat={lat}
      destLng={lng}
      initialArrivedAt={(ticket as any).arrived_at ?? null}
      initialDeliveredAt={(ticket as any).delivered_at ?? null}
      initialStatus={ticket.status}
      supabaseUrl={supabaseUrl}
      supabaseAnonKey={supabaseAnonKey}
    />
  );
}
