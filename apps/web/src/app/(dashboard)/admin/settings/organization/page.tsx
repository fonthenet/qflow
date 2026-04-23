import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { getServerI18n } from '@/lib/i18n';
import { getAllCountryConfigs, getAllVerticals } from '@/lib/country';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { OrganizationProfileClient } from './organization-profile-client';

export default async function OrganizationProfilePage() {
  const { t } = await getServerI18n();
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/settings');
  }

  const { data: organization, error: orgError } = await context.supabase
    .from('organizations')
    .select('id, name, slug, country, vertical, locale_primary, timezone')
    .eq('id', context.staff.organization_id)
    .single();

  if (orgError || !organization) {
    return (
      <div className="p-6 text-destructive">
        {t('Failed to load organization profile.')}
      </div>
    );
  }

  // Fetch country + vertical catalogs for the pickers.
  // Use a server Supabase client so no auth overhead on the client.
  const serverSupabase = await createServerClient();
  const [countries, verticals] = await Promise.all([
    getAllCountryConfigs(serverSupabase),
    getAllVerticals(serverSupabase),
  ]);

  // Compute timezone list server-side so SSR and CSR use the identical ordered
  // array (Intl.supportedValuesOf can differ in order/membership between Node's
  // ICU build and the browser — passing it as a prop eliminates hydration mismatches).
  const allTimezones: string[] = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return [];
    }
  })();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('Organization Profile')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('Set your country and vertical so Qflo can apply the correct region settings, currency, and feature set.')}
        </p>
      </div>
      <OrganizationProfileClient
        organization={{
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          country: organization.country,
          vertical: organization.vertical,
          locale_primary: organization.locale_primary,
          timezone: organization.timezone,
        }}
        countries={countries}
        verticals={verticals}
        timezones={allTimezones}
      />
    </div>
  );
}
