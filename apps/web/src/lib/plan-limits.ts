import { plans } from '@/lib/data/pricing';

export type PlanId = 'free' | 'starter' | 'growth' | 'pro' | 'enterprise';

export interface PlanLimits {
  customersPerMonth: number;
  locations: number;
  staff: number;
}

export function getPlanLimits(planId: PlanId): PlanLimits {
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return { customersPerMonth: 50, locations: 1, staff: 2 };
  return {
    customersPerMonth: plan.limits.customersPerMonth === -1 ? Infinity : plan.limits.customersPerMonth,
    locations: plan.limits.locations === -1 ? Infinity : plan.limits.locations,
    staff: plan.limits.staff === -1 ? Infinity : plan.limits.staff,
  };
}

export function hasFeature(planId: PlanId, feature: string): boolean {
  const tierOrder: PlanId[] = ['free', 'starter', 'growth', 'pro', 'enterprise'];
  const planIndex = tierOrder.indexOf(planId);

  const featureMinTier: Record<string, number> = {
    'email_notifications': 1,    // starter+
    'csv_export': 1,
    'pdf_export': 1,
    'priority_categories': 1,
    'intake_forms': 1,
    'basic_branding': 1,
    'rest_api': 2,               // growth+
    'webhooks': 2,
    'appointments': 2,
    'remote_join': 2,
    'group_tickets': 2,
    'white_label': 3,            // pro+
    'custom_qr': 3,
    'multi_language': 3,
    'advanced_analytics': 3,
    'dedicated_support': 4,      // enterprise
    'sla_guarantee': 4,
    'on_premise': 4,
  };

  const minTier = featureMinTier[feature];
  if (minTier === undefined) return true; // unknown features are allowed
  return planIndex >= minTier;
}

export function getDisplayScreenLimit(planId: PlanId): number {
  switch (planId) {
    case 'free': return 1;
    case 'starter': return 3;
    default: return Infinity;
  }
}
