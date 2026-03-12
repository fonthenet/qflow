import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { KioskView } from '@/components/kiosk/kiosk-view';

interface KioskPageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function KioskPage({ params }: KioskPageProps) {
  const { officeSlug } = await params;
  const supabase = await createClient();

  // Find office by slug (we use office name slugified)
  const { data: offices } = await supabase
    .from('offices')
    .select('*, organization:organizations(*)')
    .eq('is_active', true);

  const office = offices?.find(
    (o) =>
      o.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') === officeSlug
  );

  if (!office) notFound();

  // Get departments with services
  const { data: departments } = await supabase
    .from('departments')
    .select('*, services(*)')
    .eq('office_id', office.id)
    .eq('is_active', true)
    .order('sort_order');

  // Get active priority categories for this organization
  const { data: priorityCategories } = await supabase
    .from('priority_categories')
    .select('*')
    .eq('organization_id', office.organization_id)
    .eq('is_active', true)
    .order('weight', { ascending: false });

  // Extract kiosk settings from org
  const orgSettings = (office.organization as any)?.settings ?? {};
  const kioskSettings = {
    welcomeMessage: orgSettings.kiosk_welcome_message ?? 'Welcome',
    headerText: orgSettings.kiosk_header_text ?? '',
    themeColor: orgSettings.kiosk_theme_color ?? '',
    showPriorities: orgSettings.kiosk_show_priorities ?? true,
    showEstimatedTime: orgSettings.kiosk_show_estimated_time ?? true,
    hiddenDepartments: orgSettings.kiosk_hidden_departments ?? [],
    hiddenServices: orgSettings.kiosk_hidden_services ?? [],
    lockedDepartmentId: orgSettings.kiosk_locked_department_id ?? null,
    buttonLabel: orgSettings.kiosk_button_label ?? 'Get Ticket',
    idleTimeout: orgSettings.kiosk_idle_timeout ?? 60,
  };

  // Filter out hidden departments and services
  const filteredDepartments = (departments || [])
    .filter((d: any) => !kioskSettings.hiddenDepartments.includes(d.id))
    .map((d: any) => ({
      ...d,
      services: (d.services || []).filter(
        (s: any) => !kioskSettings.hiddenServices.includes(s.id)
      ),
    }));

  return (
    <KioskView
      office={office}
      organization={office.organization}
      departments={filteredDepartments}
      priorityCategories={kioskSettings.showPriorities ? (priorityCategories || []) : []}
      kioskSettings={kioskSettings}
    />
  );
}
