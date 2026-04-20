/**
 * Admin nav groups — the source of truth for which pages are bundled
 * together behind a single sidebar entry. Each group surfaces one row
 * in the sidebar (pointing at the first tab) and the group's tabs
 * render inside the page via `<PageTabs>`.
 *
 * NOTE: tab data is plain JSON (no function/component refs) because
 * these arrays are imported by server components and passed as props
 * into a client component. React Server Components can't serialize
 * function references across the boundary — icons are looked up on
 * the client via PageTabs.ICONS_BY_HREF.
 */
export interface PageTab {
  href: string;
  label: string;
}

export const STRUCTURE_TABS: PageTab[] = [
  { href: '/admin/offices', label: 'Locations' },
  { href: '/admin/departments', label: 'Departments' },
  { href: '/admin/services', label: 'Services' },
  { href: '/admin/desks', label: 'Desks' },
  { href: '/admin/staff', label: 'Team' },
  { href: '/admin/priorities', label: 'Priority Rules' },
];

export const PUBLIC_SCREEN_TABS: PageTab[] = [
  { href: '/admin/kiosk', label: 'Kiosk' },
  { href: '/admin/displays', label: 'Display' },
];

export const INSIGHTS_TABS: PageTab[] = [
  { href: '/admin/analytics', label: 'Reports' },
  { href: '/admin/audit', label: 'Activity Log' },
];
