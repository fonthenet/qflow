import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Use service role client for webhook (no user session)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Log event
  const orgId = (event.data.object as any)?.metadata?.organization_id;
  if (orgId) {
    await supabase.from('billing_events').insert({
      organization_id: orgId,
      event_type: event.type,
      stripe_event_id: event.id,
      data: event.data.object as any,
    });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }
  } catch (err) {
    console.error(`Error processing ${event.type}:`, err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const orgId = session.metadata?.organization_id;
  const planId = session.metadata?.plan_id;
  if (!orgId || !planId) return;

  await supabase
    .from('organizations')
    .update({
      plan_id: planId,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      subscription_status: 'active',
    })
    .eq('id', orgId);
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const orgId = subscription.metadata?.organization_id;
  if (!orgId) return;

  const planId = subscription.metadata?.plan_id || 'free';
  const status = mapSubscriptionStatus(subscription.status);

  await supabase
    .from('organizations')
    .update({
      plan_id: planId,
      stripe_subscription_id: subscription.id,
      subscription_status: status,
      current_period_end: new Date((subscription as any).current_period_end * 1000).toISOString(),
      trial_ends_at: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    })
    .eq('id', orgId);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const orgId = subscription.metadata?.organization_id;
  if (!orgId) return;

  await supabase
    .from('organizations')
    .update({
      plan_id: 'free',
      stripe_subscription_id: null,
      subscription_status: 'canceled',
      current_period_end: null,
      trial_ends_at: null,
    })
    .eq('id', orgId);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!org) return;

  await supabase.from('invoices').upsert({
    organization_id: org.id,
    stripe_invoice_id: invoice.id,
    amount_cents: invoice.amount_paid,
    currency: invoice.currency,
    status: 'paid',
    invoice_url: invoice.hosted_invoice_url,
    invoice_pdf: invoice.invoice_pdf,
    period_start: invoice.period_start
      ? new Date(invoice.period_start * 1000).toISOString()
      : null,
    period_end: invoice.period_end
      ? new Date(invoice.period_end * 1000).toISOString()
      : null,
  }, { onConflict: 'stripe_invoice_id' });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!org) return;

  await supabase
    .from('organizations')
    .update({ subscription_status: 'past_due' })
    .eq('id', org.id);

  await supabase.from('invoices').upsert({
    organization_id: org.id,
    stripe_invoice_id: invoice.id,
    amount_cents: invoice.amount_due,
    currency: invoice.currency,
    status: 'open',
    invoice_url: invoice.hosted_invoice_url,
    period_start: invoice.period_start
      ? new Date(invoice.period_start * 1000).toISOString()
      : null,
    period_end: invoice.period_end
      ? new Date(invoice.period_end * 1000).toISOString()
      : null,
  }, { onConflict: 'stripe_invoice_id' });
}

function mapSubscriptionStatus(status: Stripe.Subscription.Status): string {
  const statusMap: Record<string, string> = {
    active: 'active',
    trialing: 'trialing',
    past_due: 'past_due',
    canceled: 'canceled',
    unpaid: 'unpaid',
    incomplete: 'incomplete',
    incomplete_expired: 'canceled',
    paused: 'canceled',
  };
  return statusMap[status] || 'active';
}
