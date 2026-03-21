import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SuperAdminSidebar } from '@/components/super-admin/sidebar';
import { SUPER_ADMIN_EMAIL } from '@/lib/super-admin';

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');
  if (user.email !== SUPER_ADMIN_EMAIL) redirect('/admin/overview');

  return (
    <div className="flex h-screen bg-slate-50">
      <SuperAdminSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
