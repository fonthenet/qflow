/**
 * Admin nav groups — the source of truth for which pages are bundled
 * together behind a single sidebar entry. Each group surfaces one row
 * in the sidebar (pointing at the first tab) and the group's tabs
 * render inside the page via `<PageTabs>`.
 *
 * Keep the primary (first) entry stable — the sidebar link targets it.
 */
import type { PageTab } from './page-tabs';
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

export const STRUCTURE_TABS: PageTab[] = [
  { href: '/admin/offices', label: 'Locations', icon: Building2 },
  { href: '/admin/departments', label: 'Departments', icon: Layers },
  { href: '/admin/services', label: 'Services', icon: Grid3X3 },
  { href: '/admin/desks', label: 'Desks', icon: Monitor },
  { href: '/admin/staff', label: 'Team', icon: Users },
  { href: '/admin/priorities', label: 'Priority Rules', icon: Star },
];

export const PUBLIC_SCREEN_TABS: PageTab[] = [
  { href: '/admin/kiosk', label: 'Kiosk', icon: Tablet },
  { href: '/admin/displays', label: 'Display', icon: Tv },
];

export const INSIGHTS_TABS: PageTab[] = [
  { href: '/admin/analytics', label: 'Reports', icon: BarChart3 },
  { href: '/admin/audit', label: 'Activity Log', icon: ScrollText },
];
