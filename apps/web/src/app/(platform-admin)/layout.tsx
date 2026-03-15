import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PlatformSidebar } from '@/components/layout/platform-sidebar';

const PLATFORM_ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const email = user.email?.toLowerCase() || '';
  if (!PLATFORM_ADMIN_EMAILS.includes(email)) {
    redirect('/admin/offices');
  }

  return (
    <div className="flex h-screen">
      <PlatformSidebar email={email} />
      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        {children}
      </main>
    </div>
  );
}
