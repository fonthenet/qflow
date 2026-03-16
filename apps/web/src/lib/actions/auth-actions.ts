'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { resolveStaffProfile } from '@/lib/authz';

export async function login(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  });

  if (error) {
    return { error: error.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Signed in, but the user session could not be loaded.' };
  }

  const staff = await resolveStaffProfile(supabase, user);
  redirect(staff ? '/admin/offices' : '/account-not-linked');
}

export async function register(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = formData.get('fullName') as string;
  const organizationName = formData.get('organizationName') as string;

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

  redirect('/admin/offices');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
