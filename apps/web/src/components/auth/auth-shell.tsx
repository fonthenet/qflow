import { ArrowRight, Sparkles } from 'lucide-react';
import { Sora } from 'next/font/google';
import Link from 'next/link';
import { industryTemplates } from '@/lib/data/industry-templates';

const display = Sora({
  subsets: ['latin'],
});

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const featuredCategories = industryTemplates.slice(0, 8).map((template) => template.label);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,241,226,0.95),_rgba(250,247,241,0)_34%),radial-gradient(circle_at_right,_rgba(202,232,224,0.75),_rgba(250,247,241,0)_36%),linear-gradient(180deg,_#faf7f1_0%,_#f6f1ea_100%)]">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-10 px-6 py-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div className="flex flex-col justify-between rounded-[32px] border border-white/70 bg-[#10292f] p-8 text-white shadow-[0_30px_90px_rgba(10,26,31,0.18)] lg:min-h-[720px] lg:p-10">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
              QueueFlow
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8de2d5]">{eyebrow}</p>
            <h1 className={`${display.className} mt-4 max-w-xl text-[clamp(2.8rem,5vw,4.8rem)] leading-[0.95] tracking-[-0.055em]`}>
              {title}
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-7 text-white/72">{description}</p>
          </div>

          <div className="space-y-8">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Universal intake', value: 'QR, link, staff, kiosk' },
                { label: 'Service flow', value: 'Waiting through completed' },
                { label: 'Owner control', value: 'Plans, flags, templates' },
              ].map((item) => (
                <div key={item.label} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{item.label}</p>
                  <p className="mt-3 text-sm leading-6 text-white/88">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="h-4 w-4 text-[#f7c98b]" />
                Category-aware from day one
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {featuredCategories.map((category) => (
                  <span key={category} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[12px] font-medium text-white/75">
                    {category}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[560px] rounded-[32px] border border-slate-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(30,41,59,0.08)] backdrop-blur sm:p-8">
          {children}
          <div className="mt-8 border-t border-slate-100 pt-6 text-sm text-slate-500">{footer}</div>
        </div>
      </div>
    </div>
  );
}
