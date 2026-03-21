import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/sidebar';
import { DesktopAutoRegister } from '@/components/desktop-auto-register';
import { resolveStaffProfile } from '@/lib/authz';
import {
  getAllowedNavigation,
  getPlatformLifecycleState,
  resolvePlatformConfig,
  summarizeTemplate,
} from '@/lib/platform/config';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
  let allowedNavigation = getAllowedNavigation(platformConfig.rolePolicy, staff.role);

  // Super admin (platform owner) — full access
  const isSuperAdmin = user.email === 'f.onthenet@gmail.com';
  if (isSuperAdmin) {
    if (!allowedNavigation.includes('/admin/licenses')) {
      allowedNavigation = [...allowedNavigation, '/admin/licenses'];
    }
    if (!allowedNavigation.includes('/admin/platform')) {
      allowedNavigation = [...allowedNavigation, '/admin/platform'];
    }
  } else {
    allowedNavigation = allowedNavigation.filter((n: string) => n !== '/admin/licenses' && n !== '/admin/platform');
  }
  const templateConfigured =
    getPlatformLifecycleState(organizationSettings, {
      hasExistingData: (officeCount ?? 0) > 0,
    }) === 'template_confirmed';

  return (
    <div className="flex h-screen">
      <Sidebar
        staff={staff}
        allowedNavigation={allowedNavigation}
        isSuperAdmin={isSuperAdmin}
        templateSummary={summarizeTemplate(platformConfig)}
        templateConfigured={templateConfigured}
      />
      <DesktopAutoRegister
        officeId={staff.office_id}
        organizationId={staff.organization_id}
      />
      <main className="flex-1 overflow-y-auto bg-muted/30 p-6">
        {!templateConfigured ? (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            <p className="font-semibold text-foreground">Sandbox mode is on</p>
            <p className="mt-1">
              You are still testing your setup. Use Business Setup to try the booking and service flow before you confirm anything live.
            </p>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
