'use server';

import { createClient } from '@/lib/supabase/server';
import { stripe, getPriceId } from '@/lib/stripe';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

async function getStaffAndOrg() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: staff } = await supabase
    .from('staff')
    .select('id, role, organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff || staff.role !== 'admin') throw new Error('Not authorized');

  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', staff.organization_id)
    .single();

  if (!org) throw new Error('Organization not found');

  return { supabase, user, staff, org };
}

export async function createCheckoutSession(planId: string, period: 'monthly' | 'yearly') {
  const { org, user } = await getStaffAndOrg();

  if (planId === 'free') throw new Error('Cannot subscribe to free plan via checkout');

  const priceId = getPriceId(planId, period);
  if (!priceId) throw new Error('Stripe is not configured yet. Add STRIPE_PRICE_* environment variables to enable billing.');

  const headersList = await headers();
  const origin = headersList.get('origin') || 'https://qflow.vercel.app';

  // Create or retrieve Stripe customer
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: {
        organization_id: org.id,
        organization_name: org.name,
      },
    });
    customerId = customer.id;

    const supabase = await createClient();
    await supabase
      .from('organizations')
      .update({ stripe_customer_id: customerId })
      .eq('id', org.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/settings/billing?success=true`,
    cancel_url: `${origin}/dashboard/settings/billing?canceled=true`,
    subscription_data: {
      trial_period_days: planId !== 'enterprise' ? 14 : undefined,
      metadata: {
        organization_id: org.id,
        plan_id: planId,
      },
    },
    metadata: {
      organization_id: org.id,
      plan_id: planId,
    },
  });

  if (session.url) {
    redirect(session.url);
  }
}

export async function createBillingPortalSession() {
  const { org } = await getStaffAndOrg();

  if (!org.stripe_customer_id) {
    throw new Error('No billing account found. Subscribe to a plan first.');
  }

  const headersList = await headers();
  const origin = headersList.get('origin') || 'https://qflow.vercel.app';

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${origin}/dashboard/settings/billing`,
  });

  redirect(session.url);
}

export async function getCurrentPlan() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) return null;

  const { data: org } = await supabase
    .from('organizations')
    .select('plan_id, subscription_status, billing_period, trial_ends_at, current_period_end, monthly_visit_count, visit_count_reset_at')
    .eq('id', staff.organization_id)
    .single();

  return org;
}

export async function getInvoices() {
  const { org } = await getStaffAndOrg();

  const supabase = await createClient();
  const { data: invoices } = await supabase
    .from('invoices')
    .select('*')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: false })
    .limit(20);

  return invoices || [];
}
