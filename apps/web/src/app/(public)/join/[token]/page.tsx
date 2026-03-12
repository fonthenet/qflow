import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RemoteJoinForm } from '@/components/queue/remote-join-form';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RemoteJoinPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();

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
  const { data: office } = await supabase
    .from('offices')
    .select('id, name, address, organization:organizations(name)')
    .eq('id', virtualCode.office_id)
    .single();

  if (!office) {
    notFound();
  }

  // Fetch department info
  const { data: department } = await supabase
    .from('departments')
    .select('id, name')
    .eq('id', virtualCode.department_id)
    .single();

  // Fetch services for the department
  let services: any[] = [];
  if (virtualCode.service_id) {
    // Specific service
    const { data: service } = await supabase
      .from('services')
      .select('id, name, description, estimated_service_time')
      .eq('id', virtualCode.service_id)
      .single();
    if (service) services = [service];
  } else {
    // All services in department
    const { data: deptServices } = await supabase
      .from('services')
      .select('id, name, description, estimated_service_time')
      .eq('department_id', virtualCode.department_id)
      .eq('is_active', true)
      .order('sort_order');
    services = deptServices ?? [];
  }

  // Get estimated wait time
  const serviceIdForWait = virtualCode.service_id || services[0]?.id;
  let estimatedWait: number | null = null;
  if (serviceIdForWait) {
    const { data: waitMinutes } = await supabase.rpc('estimate_wait_time', {
      p_department_id: virtualCode.department_id,
      p_service_id: serviceIdForWait,
    });
    estimatedWait = waitMinutes ?? null;
  }

  return (
    <RemoteJoinForm
      virtualCode={virtualCode}
      office={office}
      organization={office.organization}
      department={department}
      services={services}
      hasSpecificService={!!virtualCode.service_id}
      estimatedWait={estimatedWait}
    />
  );
}
