import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { KioskView } from '@/components/kiosk/kiosk-view';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { matchesOfficePublicSlug } from '@/lib/office-links';

interface KioskPageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function KioskPage({ params }: KioskPageProps) {
  const { officeSlug } = await params;
  const supabase = createAdminClient();

  // Find office by slug (we use office name slugified)
  const { data: offices } = await supabase
    .from('offices')
    .select('*, organization:organizations(*)')
    .eq('is_active', true);

  const office = offices?.find((entry) => matchesOfficePublicSlug(entry, officeSlug));

  if (!office) notFound();
  const platformConfig = resolvePlatformConfig({
    organizationSettings: (office.organization as any)?.settings ?? {},
    officeSettings: office.settings ?? {},
  });

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

  // Extract kiosk settings from resolved platform config plus legacy overrides.
  const orgSettings = (office.organization as any)?.settings ?? {};
  const organizationLogoUrl = (office.organization as any)?.logo_url ?? null;
  const officeSettings = (office.settings as Record<string, any> | null) ?? {};
  const profile = platformConfig.experienceProfile.kiosk;
  const kioskSettings = {
    welcomeMessage: orgSettings.kiosk_welcome_message ?? profile.welcomeMessage,
    headerText: orgSettings.kiosk_header_text ?? profile.headerText,
    themeColor: orgSettings.kiosk_theme_color ?? profile.themeColor,
    logoUrl: orgSettings.kiosk_logo_url ?? organizationLogoUrl,
    showLogo: orgSettings.kiosk_show_logo ?? Boolean(orgSettings.kiosk_logo_url ?? organizationLogoUrl),
    showPriorities:
      orgSettings.kiosk_show_priorities ??
      (platformConfig.queuePolicy.priorityMode !== 'none' && profile.showPriorities),
    showEstimatedTime: orgSettings.kiosk_show_estimated_time ?? profile.showEstimatedTime,
    hiddenDepartments: orgSettings.kiosk_hidden_departments ?? officeSettings.kiosk_hidden_departments ?? [],
    hiddenServices: orgSettings.kiosk_hidden_services ?? officeSettings.kiosk_hidden_services ?? [],
    lockedDepartmentId:
      orgSettings.kiosk_locked_department_id ?? officeSettings.kiosk_locked_department_id ?? null,
    buttonLabel: orgSettings.kiosk_button_label ?? profile.buttonLabel,
    idleTimeout: orgSettings.kiosk_idle_timeout ?? profile.idleTimeoutSeconds,
    showAppointmentCheckIn: orgSettings.kiosk_show_appointment_checkin ?? true,
    showGroupTickets: orgSettings.kiosk_show_group_tickets ?? true,
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
      vertical={platformConfig.selection.vertical}
      stationLocalUrl={officeSettings.station_local_url ?? null}
    />
  );
}
