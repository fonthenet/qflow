import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { KioskView } from '@/components/kiosk/kiosk-view';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { ServiceUnavailable } from '@/components/service-unavailable';

interface KioskPageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function KioskPage({ params }: KioskPageProps) {
  const { officeSlug } = await params;

  try {
    const supabase = createAdminClient();

    // Find office by slug (we use office name slugified)
    const { data: offices } = await supabase
      .from('offices')
      .select('*, organization:organizations(*)')
      .eq('is_active', true);

    const office = offices?.find((entry) => matchesOfficePublicSlug(entry, officeSlug));

    if (!office) notFound();
    const _orgSettings = (office.organization as any)?.settings ?? {};
    if (_orgSettings.kiosk_enabled === false) notFound();
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
      vertical: platformConfig.template.vertical,
      mode: orgSettings.kiosk_mode ?? profile.mode,
      showPriorities:
        orgSettings.priorities_enabled === false
          ? false
          : (orgSettings.kiosk_show_priorities ??
            (platformConfig.queuePolicy.priorityMode !== 'none' && profile.showPriorities)),
      showEstimatedTime: orgSettings.kiosk_show_estimated_time ?? profile.showEstimatedTime,
      hiddenDepartments:
        officeSettings.kiosk_override_visibility === true
          ? (officeSettings.kiosk_hidden_departments ?? [])
          : (orgSettings.kiosk_hidden_departments ?? []),
      hiddenServices:
        officeSettings.kiosk_override_visibility === true
          ? (officeSettings.kiosk_hidden_services ?? [])
          : (orgSettings.kiosk_hidden_services ?? []),
      lockedDepartmentId:
        officeSettings.kiosk_override_visibility === true
          ? (officeSettings.kiosk_locked_department_id ?? null)
          : (orgSettings.kiosk_locked_department_id ?? null),
      buttonLabel: orgSettings.kiosk_button_label ?? profile.buttonLabel,
      idleTimeout: orgSettings.kiosk_idle_timeout ?? profile.idleTimeoutSeconds,
      visitIntakeOverrideMode:
        orgSettings.visit_intake_override_mode ??
        officeSettings.visit_intake_override_mode ??
        'business_hours',
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
  } catch (error) {
    console.error('[kiosk-page] Database error:', error);
    return (
      <ServiceUnavailable
        title="Kiosk temporarily unavailable"
        message="Unable to connect to the server. Please try again in a few minutes or ask staff for assistance."
      />
    );
  }
}
