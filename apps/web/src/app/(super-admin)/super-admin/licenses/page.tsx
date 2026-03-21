import { requireSuperAdmin } from '@/lib/super-admin';
import { LicensesManager } from '@/components/super-admin/licenses';

export default async function LicensesPage() {
  const { admin } = await requireSuperAdmin();

  const [
    { data: organizations },
    { data: licenses },
    { data: pendingDevices },
  ] = await Promise.all([
    admin.from('organizations').select('id, name').order('name'),
    admin.from('station_licenses').select('*').order('created_at', { ascending: false }),
    admin.from('pending_device_activations').select('*').eq('status', 'pending').order('requested_at', { ascending: false }),
  ]);

  return (
    <LicensesManager
      organizations={organizations ?? []}
      licenses={licenses ?? []}
      pendingDevices={pendingDevices ?? []}
    />
  );
}
