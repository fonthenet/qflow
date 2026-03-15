'use server';

import { createClient } from '@/lib/supabase/server';
import { getPlanLimits, hasFeature, type PlanId } from '@/lib/plan-limits';

interface OrgPlanInfo {
  organizationId: string;
  planId: PlanId;
  subscriptionStatus: string;
  monthlyVisitCount: number;
}

export async function getOrgPlan(): Promise<OrgPlanInfo | null> {
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
    .select('id, plan_id, subscription_status, monthly_visit_count')
    .eq('id', staff.organization_id)
    .single();
  if (!org) return null;

  return {
    organizationId: org.id,
    planId: org.plan_id as PlanId,
    subscriptionStatus: org.subscription_status,
    monthlyVisitCount: org.monthly_visit_count,
  };
}

export async function checkVisitLimit(): Promise<{ allowed: boolean; remaining: number }> {
  const plan = await getOrgPlan();
  if (!plan) return { allowed: false, remaining: 0 };

  const limits = getPlanLimits(plan.planId);
  const remaining = limits.customersPerMonth === Infinity
    ? Infinity
    : limits.customersPerMonth - plan.monthlyVisitCount;

  return {
    allowed: remaining > 0 || limits.customersPerMonth === Infinity,
    remaining: remaining === Infinity ? 999999 : Math.max(0, remaining),
  };
}

export async function checkStaffLimit(): Promise<{ allowed: boolean; current: number; limit: number }> {
  const plan = await getOrgPlan();
  if (!plan) return { allowed: false, current: 0, limit: 0 };

  const limits = getPlanLimits(plan.planId);

  const supabase = await createClient();
  const { count } = await supabase
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', plan.organizationId)
    .eq('is_active', true);

  const current = count || 0;

  return {
    allowed: limits.staff === Infinity || current < limits.staff,
    current,
    limit: limits.staff === Infinity ? 999999 : limits.staff,
  };
}

export async function checkLocationLimit(): Promise<{ allowed: boolean; current: number; limit: number }> {
  const plan = await getOrgPlan();
  if (!plan) return { allowed: false, current: 0, limit: 0 };

  const limits = getPlanLimits(plan.planId);

  const supabase = await createClient();
  const { count } = await supabase
    .from('offices')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', plan.organizationId)
    .eq('is_active', true);

  const current = count || 0;

  return {
    allowed: limits.locations === Infinity || current < limits.locations,
    current,
    limit: limits.locations === Infinity ? 999999 : limits.locations,
  };
}

export async function checkFeatureAccess(feature: string): Promise<boolean> {
  const plan = await getOrgPlan();
  if (!plan) return false;
  return hasFeature(plan.planId, feature);
}
