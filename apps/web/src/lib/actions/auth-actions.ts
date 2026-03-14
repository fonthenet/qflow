'use server';

import { createClient } from '@/lib/supabase/server';
import { getIndustryTemplate } from '@/lib/data/industry-templates';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

async function getAppUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }

  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') || headerStore.get('host');
  const proto = headerStore.get('x-forwarded-proto') || 'http';

  if (!host) {
    return 'http://localhost:3000';
  }

  return `${proto}://${host}`;
}

export async function login(formData: FormData) {
  const supabase = await createClient();

  const { data: authData, error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  });

  if (error) {
    return { error: error.message };
  }

  // Check if onboarding is completed
  if (authData.user) {
    const { data: staff } = await supabase
      .from('staff')
      .select('organization:organizations(onboarding_completed)')
      .eq('auth_user_id', authData.user.id)
      .single();

    const org = staff?.organization as unknown as Record<string, unknown> | null;
    if (org && !org.onboarding_completed) {
      redirect('/setup');
    }
  }

  redirect('/admin/queue');
}

export async function register(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = formData.get('fullName') as string;
  const organizationName = formData.get('organizationName') as string;
  const businessType = (formData.get('businessType') as string) || 'other';
  const businessSubtype = (formData.get('businessSubtype') as string) || 'generic';
  const operatingModel = (formData.get('operatingModel') as string) || 'hybrid';
  const arrivalMode = (formData.get('arrivalMode') as string) || 'qr_and_staff';

  // Create the auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        organization_name: organizationName,
      },
    },
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: 'Registration failed. Please try again.' };
  }

  // Create organization and staff record via RPC
  const slug = organizationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const { error: orgError } = await supabase.rpc('create_organization_with_admin', {
    p_org_name: organizationName,
    p_org_slug: slug,
    p_admin_name: fullName,
    p_admin_email: email,
    p_auth_user_id: authData.user.id,
  });

  if (orgError) {
    return { error: orgError.message };
  }

  const template = getIndustryTemplate(businessType);
  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', authData.user.id)
    .single();

  if (staff?.organization_id) {
    await supabase
      .from('organizations')
      .update({
        business_type: businessType,
        business_subtype: businessSubtype,
        onboarding_step: 1,
        settings: {
          operating_mode: operatingModel,
          arrival_mode: arrivalMode,
          feature_flags: template?.featureFlags || [],
          terminology: template?.terminology || null,
          business_size: 'small',
          location_count: '1',
          ...template?.recommendedSettings,
        },
      })
      .eq('id', staff.organization_id);
  }

  redirect('/setup');
}

export async function requestMagicLink(formData: FormData) {
  const supabase = await createClient();
  const email = (formData.get('email') as string) || '';

  if (!email) {
    return { error: 'Enter your email to receive a sign-in link.' };
  }

  const appUrl = await getAppUrl();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback?next=/admin/queue`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
