import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/sidebar';

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
  const { data: staff } = await supabase
    .from('staff')
    .select('*, organization:organizations(*)')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  return (
    <div className="flex h-screen">
      <Sidebar staff={staff} />
      <main className="flex-1 overflow-y-auto bg-muted/30 p-6">
        {children}
      </main>
    </div>
  );
}
