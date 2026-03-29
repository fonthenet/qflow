import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/sidebar';
import { resolveStaffProfile } from '@/lib/authz';
import {
  getAllowedNavigation,
  getPlatformLifecycleState,
  resolvePlatformConfig,
  summarizeTemplate,
} from '@/lib/platform/config';
import { getServerI18n } from '@/lib/i18n';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = await getServerI18n();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Get staff profile
  const staffProfile = await resolveStaffProfile(supabase, user);

  if (!staffProfile) redirect('/account-not-linked');

  const { data: staff } = await supabase
    .from('staff')
    .select('*, organization:organizations(*)')
    .eq('id', staffProfile.id)
    .single();

  if (!staff) redirect('/account-not-linked');
  const { count: officeCount } = await supabase
    .from('offices')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', staff.organization_id);
  const organizationSettings = ((staff.organization as any)?.settings ?? {}) as Record<string, unknown>;
  const platformConfig = resolvePlatformConfig({ organizationSettings });
  const allowedNavigation = getAllowedNavigation(platformConfig.rolePolicy, staff.role);
  const templateConfigured =
    getPlatformLifecycleState(organizationSettings, {
      hasExistingData: (officeCount ?? 0) > 0,
    }) === 'template_confirmed';

  return (
    <div className="flex h-screen">
      <Sidebar
        staff={staff}
        allowedNavigation={allowedNavigation}
        templateSummary={summarizeTemplate(platformConfig)}
        templateConfigured={templateConfigured}
      />
      <main className="flex-1 overflow-y-auto bg-background p-6">
        {!templateConfigured ? (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            <p className="font-semibold text-foreground">{t('Sandbox mode is on')}</p>
            <p className="mt-1">
              {t(
                'You are still testing your setup. Use Business Setup to try the booking and service flow before you confirm anything live.'
              )}
            </p>
          </div>
        ) : templateConfigured &&
          !organizationSettings.business_setup_wizard_completed_at &&
          (staff.role === 'admin' || staff.role === 'manager') ? (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900 flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">{t('Complete your business setup')}</p>
              <p className="mt-1">
                {t('Your template is confirmed. Complete the setup wizard to configure offices, desks, staff, and start serving customers.')}
              </p>
            </div>
            <a
              href="/admin/setup-wizard"
              className="ml-4 whitespace-nowrap rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              {t('Open Wizard')}
            </a>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
