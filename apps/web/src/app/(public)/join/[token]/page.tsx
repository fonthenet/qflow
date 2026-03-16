import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { RemoteJoinForm } from '@/components/queue/remote-join-form';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RemoteJoinPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = createAdminClient();

  // Fetch the virtual queue code by qr_token
  const { data: virtualCode, error } = await supabase
    .from('virtual_queue_codes')
    .select('*')
    .eq('qr_token', token)
    .single();

  if (error || !virtualCode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-sm rounded-xl bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <svg className="h-8 w-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-foreground">Invalid QR Code</h1>
          <p className="text-sm text-muted-foreground">
            This virtual queue link is invalid or has expired.
          </p>
        </div>
      </div>
    );
  }

  if (!virtualCode.is_active) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-sm rounded-xl bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
            <svg className="h-8 w-8 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-foreground">Queue Temporarily Closed</h1>
          <p className="text-sm text-muted-foreground">
            This virtual queue is currently inactive. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  // Fetch related office info
  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name, logo_url, settings')
    .eq('id', virtualCode.organization_id)
    .single();

  if (!organization) notFound();

  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, address, settings')
    .eq('organization_id', virtualCode.organization_id)
    .eq('is_active', true)
    .order('name');

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, office_id')
    .in('office_id', (offices ?? []).map((office) => office.id))
    .eq('is_active', true)
    .order('sort_order');

  const { data: services } = await supabase
    .from('services')
    .select('id, name, description, estimated_service_time, department_id')
    .in('department_id', (departments ?? []).map((department) => department.id))
    .eq('is_active', true)
    .order('sort_order');

  const { data: waitingTickets } = await supabase
    .from('tickets')
    .select('id, office_id, department_id, service_id')
    .in('office_id', (offices ?? []).map((item) => item.id))
    .eq('status', 'waiting');

  const office = virtualCode.office_id
    ? (offices ?? []).find((item) => item.id === virtualCode.office_id) ?? null
    : null;
  const department = virtualCode.department_id
    ? (departments ?? []).find((item) => item.id === virtualCode.department_id) ?? null
    : null;
  const service = virtualCode.service_id
    ? (services ?? []).find((item) => item.id === virtualCode.service_id) ?? null
    : null;

  let estimatedWait: number | null = null;
  if (department?.id && service?.id) {
    const { data: waitMinutes } = await supabase.rpc('estimate_wait_time', {
      p_department_id: department.id,
      p_service_id: service.id,
    });
    estimatedWait = waitMinutes ?? null;
  }

  const platformConfig = resolvePlatformConfig({
    organizationSettings: organization.settings ?? {},
    officeSettings: office?.settings ?? {},
  });

  return (
    <RemoteJoinForm
      virtualCode={virtualCode}
      office={office}
      organization={organization}
      department={department}
      services={service ? [service] : services ?? []}
      hasSpecificService={!!service}
      estimatedWait={estimatedWait}
      offices={offices ?? []}
      departments={departments ?? []}
      waitingTickets={waitingTickets ?? []}
      publicJoinProfile={platformConfig.experienceProfile.publicJoin}
      vocabulary={platformConfig.experienceProfile.vocabulary}
    />
  );
}
