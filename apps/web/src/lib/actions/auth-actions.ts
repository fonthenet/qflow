'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { resolveStaffProfile } from '@/lib/authz';
import { SUPER_ADMIN_EMAIL } from '@/lib/super-admin';

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

  if (user.email === SUPER_ADMIN_EMAIL) {
    redirect('/super-admin');
  }

  const staff = await resolveStaffProfile(supabase, user);
  redirect(staff ? '/admin/offices' : '/account-not-linked');
}

export async function register(formData: FormData) {
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const fullName = (formData.get('fullName') as string | null)?.trim() ?? '';
  const organizationName = (formData.get('organizationName') as string | null)?.trim() ?? '';
  const countryCode = (formData.get('country') as string | null)?.trim() || null;
  const cityName = (formData.get('city') as string | null)?.trim() || null;
  const locale = (formData.get('locale') as string | null)?.trim() || 'fr';

  if (!email || !password || !fullName || !organizationName) {
    return { error: 'Please fill in all required fields.' };
  }

  // Route through the same /api/onboarding/create-business endpoint the
  // Station signup uses, so both paths land on identical org wiring:
  // country/timezone/locale on the first-class columns, business_country
  // / business_city / directory listing in settings. The endpoint
  // gracefully skips office/dept/service/desk when category+officeName
  // aren't provided — the setup wizard will handle those.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto =
    h.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  let json: any = null;
  try {
    const res = await fetch(`${origin}/api/onboarding/create-business`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        fullName,
        businessName: organizationName,
        country: countryCode,
        city: cityName,
        locale,
      }),
    });
    json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: json?.error ?? 'Registration failed. Please try again.' };
    }
  } catch (err: any) {
    return { error: err?.message ?? 'Network error. Please try again.' };
  }

  // Exchange the returned tokens for a Supabase session cookie so the
  // admin lands on /admin/setup-wizard already signed in.
  if (json?.session?.access_token && json?.session?.refresh_token) {
    const supabase = await createClient();
    await supabase.auth.setSession({
      access_token: json.session.access_token,
      refresh_token: json.session.refresh_token,
    });
  }

  redirect('/admin/setup-wizard');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
