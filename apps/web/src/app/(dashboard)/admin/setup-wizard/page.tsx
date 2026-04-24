import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { SetupWizardClient } from './setup-wizard-client';

// ── /admin/setup-wizard (post-register) ───────────────────────────
// The signed-in admin finishes setting up their business here. The page
// is a thin shell — the wizard client is spec-driven (see
// `@qflo/shared/setup-wizard`) and posts to `/api/setup-wizard/seed`.
// If the wizard has already run, we just send them to the dashboard.

export default async function SetupWizardPage() {
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/offices');
  }

  const orgId = context.staff.organization_id;

  const { data: organization } = await context.supabase
    .from('organizations')
    .select('id, name, settings')
    .eq('id', orgId)
    .single();

  if (!organization) redirect('/admin/offices');

  const settings = (organization.settings as Record<string, any>) ?? {};
  if (settings.business_setup_wizard_completed_at) {
    redirect('/admin/overview');
  }

  return (
    <SetupWizardClient
      organizationName={organization.name ?? ''}
      initialCategory={settings.business_category ?? null}
    />
  );
}
