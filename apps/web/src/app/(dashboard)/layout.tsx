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
    <div className="flex min-h-screen bg-[linear-gradient(180deg,#eef2f7_0%,#f8fafc_26%,#f5f7fb_100%)]">
      <Sidebar staff={staff} isPlatformAdmin={isPlatformAdmin} />
      <TerminologyProvider terminology={terminology}>
        <main className="flex-1 overflow-y-auto">
          <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(148,163,184,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.10),transparent_24%)] px-5 py-6 md:px-8 md:py-8">
            <div className="mx-auto max-w-[1460px]">
              {children}
            </div>
          </div>
        </main>
      </TerminologyProvider>
    </div>
  );
}
