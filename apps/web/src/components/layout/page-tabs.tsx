'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  Layers,
  Grid3X3,
  Monitor,
  Users,
  Star,
  Tablet,
  Tv,
  BarChart3,
  ScrollText,
} from 'lucide-react';
import { useI18n } from '@/components/providers/locale-provider';
import type { PageTab } from './admin-nav-groups';

/**
 * Icons looked up by href so tab data stays serializable when passed from
 * a server component into this client component. Keys must match the
 * tab `href` values declared in `admin-nav-groups.ts`.
 */
const ICON_BY_HREF: Record<string, React.ComponentType<{ className?: string }>> = {
  '/admin/offices': Building2,
  '/admin/departments': Layers,
  '/admin/services': Grid3X3,
  '/admin/desks': Monitor,
  '/admin/staff': Users,
  '/admin/priorities': Star,
  '/admin/kiosk': Tablet,
  '/admin/displays': Tv,
  '/admin/analytics': BarChart3,
  '/admin/audit': ScrollText,
};

/**
 * Horizontal tab strip used to group related admin routes under one sidebar
 * entry. Each tab is a real `<Link>` to its own route, so deep-links and
 * role-based route guards keep working exactly as before — this is pure
 * navigation furniture that unifies sibling pages visually.
 *
 * Only tabs whose `href` is present in `allowed` are rendered; callers pass
 * the organization's `allowedNavigation` array so a role that can't see one
 * of the siblings simply sees a narrower strip.
 */
export function PageTabs({ tabs, allowed }: { tabs: PageTab[]; allowed?: string[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const visible = allowed ? tabs.filter((tb) => allowed.includes(tb.href)) : tabs;
  if (visible.length <= 1) return null;

  return (
    <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
      {visible.map((tb) => {
        const isActive = pathname === tb.href || pathname.startsWith(tb.href + '/');
        const Icon = ICON_BY_HREF[tb.href];
        return (
          <Link
            key={tb.href}
            href={tb.href}
            prefetch
            className={[
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            ].join(' ')}
          >
            {Icon ? <Icon className="h-4 w-4" /> : null}
            {t(tb.label)}
          </Link>
        );
      })}
    </div>
  );
}
