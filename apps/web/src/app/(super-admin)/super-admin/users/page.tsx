import { requireSuperAdmin } from '@/lib/super-admin';
import { UsersManager } from '@/components/super-admin/users';

export default async function UsersPage() {
  const { admin } = await requireSuperAdmin();

  const [
    { data: staff },
    { data: organizations },
  ] = await Promise.all([
    admin.from('staff').select('id, full_name, email, role, is_active, organization_id, office_id, created_at').order('created_at', { ascending: false }),
    admin.from('organizations').select('id, name'),
  ]);

  const orgMap: Record<string, string> = {};
  (organizations ?? []).forEach((o: any) => { orgMap[o.id] = o.name; });

  const users = (staff ?? []).map((s: any) => ({
    ...s,
    organization_name: orgMap[s.organization_id] ?? 'Unknown',
  }));

  return <UsersManager users={users} organizations={organizations ?? []} />;
}
