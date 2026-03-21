import { requireSuperAdmin, SUPER_ADMIN_EMAIL } from '@/lib/super-admin';
import { PlatformSettings } from '@/components/super-admin/settings';

export default async function SettingsPage() {
  const { admin } = await requireSuperAdmin();

  const [
    { count: totalOrgs },
    { count: totalLicenses },
  ] = await Promise.all([
    admin.from('organizations').select('id', { count: 'exact', head: true }),
    admin.from('station_licenses').select('id', { count: 'exact', head: true }),
  ]);

  return (
    <PlatformSettings
      platformDomain="qflow-sigma.vercel.app"
      superAdminEmail={SUPER_ADMIN_EMAIL}
      totalOrgs={totalOrgs ?? 0}
      totalLicenses={totalLicenses ?? 0}
      dbRegion="EU West"
    />
  );
}
