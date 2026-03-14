import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,241,226,0.95),_rgba(250,247,241,0)_34%),radial-gradient(circle_at_right,_rgba(202,232,224,0.75),_rgba(250,247,241,0)_36%),linear-gradient(180deg,_#faf7f1_0%,_#f6f1ea_100%)]">
      <header className="border-b border-white/70 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span className="text-xl font-semibold tracking-tight text-slate-950">QueueFlow</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Workspace onboarding</span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 lg:py-10">{children}</main>
    </div>
  );
}
