import { requireSuperAdmin } from '@/lib/super-admin';
import { PlatformSettings } from '@/components/super-admin/settings';

export default async function SettingsPage() {
  await requireSuperAdmin();
  return <PlatformSettings />;
}
