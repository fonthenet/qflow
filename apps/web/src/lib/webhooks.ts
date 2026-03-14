import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type WebhookEvent =
  | 'ticket.created'
  | 'ticket.called'
  | 'ticket.serving'
  | 'ticket.served'
  | 'ticket.no_show'
  | 'ticket.cancelled'
  | 'ticket.transferred';

export async function dispatchWebhook(
  organizationId: string,
  eventType: WebhookEvent,
  payload: Record<string, any>
) {
  // Find active webhook endpoints subscribed to this event
  const { data: endpoints } = await supabase
    .from('webhook_endpoints')
    .select('id, url, secret, events, failure_count')
    .eq('organization_id', organizationId)
    .eq('is_active', true);

  if (!endpoints?.length) return;

  const matchingEndpoints = endpoints.filter(
    (ep) => ep.events.length === 0 || ep.events.includes(eventType)
  );

  const body = JSON.stringify({
    event: eventType,
    data: payload,
    timestamp: new Date().toISOString(),
  });

  await Promise.allSettled(
    matchingEndpoints.map(async (endpoint) => {
      const signature = crypto
        .createHmac('sha256', endpoint.secret)
        .update(body)
        .digest('hex');

      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-QueueFlow-Signature': signature,
            'X-QueueFlow-Event': eventType,
          },
          body,
          signal: AbortSignal.timeout(10000),
        });

        await supabase.from('webhook_deliveries').insert({
          endpoint_id: endpoint.id,
          event_type: eventType,
          payload,
          response_status: response.status,
          response_body: await response.text().catch(() => ''),
        });

        if (response.ok) {
          await supabase
            .from('webhook_endpoints')
            .update({ last_triggered_at: new Date().toISOString(), failure_count: 0 })
            .eq('id', endpoint.id);
        } else {
          await supabase
            .from('webhook_endpoints')
            .update({
              failure_count: endpoint.failure_count + 1,
              is_active: endpoint.failure_count + 1 < 10, // auto-disable after 10 failures
            })
            .eq('id', endpoint.id);
        }
      } catch (err: any) {
        await supabase.from('webhook_deliveries').insert({
          endpoint_id: endpoint.id,
          event_type: eventType,
          payload,
          response_status: 0,
          response_body: err.message || 'Connection failed',
        });

        await supabase
          .from('webhook_endpoints')
          .update({ failure_count: endpoint.failure_count + 1 })
          .eq('id', endpoint.id);
      }
    })
  );
}
