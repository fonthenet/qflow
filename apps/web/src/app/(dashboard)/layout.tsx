import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/sidebar';
import { TerminologyProvider } from '@/lib/terminology-context';
import { getDefaultTerminology, type IndustryTerminology } from '@/lib/data/industry-templates';

const PLATFORM_ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

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

  // Redirect to onboarding if not completed
  const org = staff.organization as Record<string, unknown> | null;
  if (org && !org.onboarding_completed) {
    redirect('/setup');
  }

  // Extract terminology from org settings
  const orgSettings = (org?.settings as Record<string, unknown>) || null;
  const terminology = (orgSettings?.terminology as IndustryTerminology) || getDefaultTerminology();

  // Check platform admin access
  const isPlatformAdmin = PLATFORM_ADMIN_EMAILS.includes(
    user.email?.toLowerCase() || ''
  );

  return (
    <div className="flex h-screen">
      <Sidebar staff={staff} isPlatformAdmin={isPlatformAdmin} />
      <TerminologyProvider terminology={terminology}>
        <main className="flex-1 overflow-y-auto bg-muted/30 p-6">
          {children}
        </main>
      </TerminologyProvider>
    </div>
  );
}
