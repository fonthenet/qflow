import { createClient } from '@/lib/supabase/server';
import { BillingOverviewClient } from './billing-client';

export default async function BillingPage() {
  const supabase = await createClient();

  const { data: organizations } = await supabase
    .from('organizations')
    .select('id, name, slug, plan_id, subscription_status, billing_period, trial_ends_at, current_period_end, monthly_visit_count, stripe_customer_id, created_at')
    .order('created_at', { ascending: false });

  // Get plan distribution
  const planCounts: Record<string, number> = {};
  let totalMRR = 0;
  const planPrices: Record<string, number> = {
    starter: 29,
    growth: 79,
    pro: 199,
    enterprise: 499,
  };

  (organizations || []).forEach((org: any) => {
    const plan = org.plan_id || 'free';
    planCounts[plan] = (planCounts[plan] || 0) + 1;
    if (org.subscription_status === 'active' && planPrices[plan]) {
      totalMRR += planPrices[plan];
    }
  });

  // Stripe configuration status
  const stripeConfig = {
    secretKey: !!process.env.STRIPE_SECRET_KEY,
    webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      starter: {
        monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
        yearly: process.env.STRIPE_PRICE_STARTER_YEARLY || '',
      },
      growth: {
        monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY || '',
        yearly: process.env.STRIPE_PRICE_GROWTH_YEARLY || '',
      },
      pro: {
        monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
        yearly: process.env.STRIPE_PRICE_PRO_YEARLY || '',
      },
      enterprise: {
        monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY || '',
        yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY || '',
      },
    },
  };

  return (
    <BillingOverviewClient
      organizations={organizations || []}
      planCounts={planCounts}
      totalMRR={totalMRR}
      stripeConfig={stripeConfig}
    />
  );
}
