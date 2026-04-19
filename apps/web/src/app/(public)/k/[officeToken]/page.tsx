import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { KioskView } from '@/components/kiosk/kiosk-view';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { matchesOfficePublicToken } from '@/lib/office-links';
import { ServiceUnavailable } from '@/components/service-unavailable';

interface ShortKioskPageProps {
  params: Promise<{ officeToken: string }>;
}

export default async function ShortKioskPage({ params }: ShortKioskPageProps) {
  const { officeToken } = await params;

  try {
    const supabase = createAdminClient();

    const { data: offices } = await supabase
      .from('offices')
      .select('*, organization:organizations(*)')
      .eq('is_active', true);

    const office = offices?.find((entry) => matchesOfficePublicToken(entry, officeToken));

    if (!office) notFound();
    const _orgSettings = (office.organization as any)?.settings ?? {};
    if (_orgSettings.kiosk_enabled === false) notFound();
    const platformConfig = resolvePlatformConfig({
      organizationSettings: (office.organization as any)?.settings ?? {},
      officeSettings: office.settings ?? {},
    });

    const { data: departments } = await supabase
      .from('departments')
      .select('*, services(*)')
      .eq('office_id', office.id)
      .eq('is_active', true)
      .order('sort_order');

    const { data: priorityCategories } = await supabase
      .from('priority_categories')
      .select('*')
      .eq('organization_id', office.organization_id)
      .eq('is_active', true)
      .order('weight', { ascending: false });

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
      hiddenDepartments: orgSettings.kiosk_hidden_departments ?? officeSettings.kiosk_hidden_departments ?? [],
      hiddenServices: orgSettings.kiosk_hidden_services ?? officeSettings.kiosk_hidden_services ?? [],
      lockedDepartmentId:
        orgSettings.kiosk_locked_department_id ?? officeSettings.kiosk_locked_department_id ?? null,
      buttonLabel: orgSettings.kiosk_button_label ?? profile.buttonLabel,
      idleTimeout: orgSettings.kiosk_idle_timeout ?? profile.idleTimeoutSeconds,
      visitIntakeOverrideMode:
        orgSettings.visit_intake_override_mode ??
        officeSettings.visit_intake_override_mode ??
        'business_hours',
    };

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
