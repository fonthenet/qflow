import { Navbar } from '@/components/marketing/navbar';
import { Footer } from '@/components/marketing/footer';
import { createClient } from '@/lib/supabase/server';

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let organizationName: string | null = null;

  if (user) {
    const { data: staff } = await supabase
      .from('staff')
      .select('organization_id')
      .eq('auth_user_id', user.id)
      .single();

    if (staff?.organization_id) {
      const { data: organization } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', staff.organization_id)
        .single();

      organizationName = organization?.name ?? null;
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar signedIn={Boolean(user)} organizationName={organizationName} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
