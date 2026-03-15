'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getIndustryTemplate } from '@/lib/data/industry-templates';

export async function saveBusinessType(data: {
  businessType: string;
  businessSubtype: string;
  businessSize: string;
  locationCount: string;
  operatingMode: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) return { error: 'No organization found' };

  const template = getIndustryTemplate(data.businessType);

  const { error } = await supabase
    .from('organizations')
    .update({
      business_type: data.businessType,
      business_subtype: data.businessSubtype,
      onboarding_step: 2,
      settings: {
        business_size: data.businessSize,
        location_count: data.locationCount,
        operating_mode: data.operatingMode,
        feature_flags: template?.featureFlags || [],
        terminology: template?.terminology || null,
        ...template?.recommendedSettings,
      },
    })
    .eq('id', staff.organization_id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function completeOnboarding(data: {
  office: {
    name: string;
    address?: string;
    timezone: string;
  };
  departments: {
    name: string;
    code: string;
    services: { name: string; code: string; estimatedTime: number }[];
  }[];
  priorities: {
    name: string;
    icon: string;
    color: string;
    weight: number;
  }[];
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id, organization:organizations(*)')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) return { error: 'No organization found' };

  const orgId = staff.organization_id;

  // 1. Create the office
  const { data: office, error: officeError } = await supabase
    .from('offices')
    .insert({
      organization_id: orgId,
      name: data.office.name,
      address: data.office.address || null,
      timezone: data.office.timezone,
      is_active: true,
    })
    .select('id')
    .single();

  if (officeError || !office) return { error: officeError?.message || 'Failed to create office' };

  // 2. Create departments and services
  for (let deptIdx = 0; deptIdx < data.departments.length; deptIdx++) {
    const dept = data.departments[deptIdx];

    const { data: department, error: deptError } = await supabase
      .from('departments')
      .insert({
        office_id: office.id,
        name: dept.name,
        code: dept.code,
        is_active: true,
        sort_order: deptIdx,
      })
      .select('id')
      .single();

    if (deptError || !department) continue;

    // Create services for this department
    const serviceInserts = dept.services.map((svc, svcIdx) => ({
      department_id: department.id,
      name: svc.name,
      code: svc.code,
      estimated_service_time: svc.estimatedTime,
      is_active: true,
      sort_order: svcIdx,
    }));

    if (serviceInserts.length > 0) {
      await supabase.from('services').insert(serviceInserts);
    }
  }

  // 3. Create priority categories
  if (data.priorities.length > 0) {
    const priorityInserts = data.priorities.map((p) => ({
      organization_id: orgId,
      name: p.name,
      icon: p.icon,
      color: p.color,
      weight: p.weight,
      is_active: true,
    }));

    await supabase.from('priority_categories').insert(priorityInserts);
  }

  // 4. Mark onboarding as completed
  const { error: updateError } = await supabase
    .from('organizations')
    .update({
      onboarding_completed: true,
      onboarding_step: 5,
    })
    .eq('id', orgId);

  if (updateError) return { error: updateError.message };

  redirect('/admin/offices');
}
