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
    redirect('/admin/queue');
  }

  return (
    <div className="flex min-h-screen bg-[#f6f1ea]">
      <PlatformSidebar email={email} />
      <main className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-[linear-gradient(180deg,_#f8f4ee_0%,_#f6f1ea_100%)] p-5 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
