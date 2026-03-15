import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not configured. Add it to your environment variables.');
    }
    _stripe = new Stripe(key, {
      apiVersion: '2026-02-25.clover',
      typescript: true,
    });
  }
  return _stripe;
}

// Keep backward-compatible export (lazy getter)
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return (getStripe() as any)[prop];
  },
});

// Map plan IDs to Stripe Price IDs (set these in env vars after creating products in Stripe)
export const STRIPE_PRICE_IDS: Record<string, { monthly: string; yearly: string }> = {
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
};

export function getPriceId(planId: string, period: 'monthly' | 'yearly'): string | null {
  const plan = STRIPE_PRICE_IDS[planId];
  if (!plan) return null;
  return plan[period] || null;
}
