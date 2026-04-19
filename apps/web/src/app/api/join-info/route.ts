import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOfficePublicSlug } from '@/lib/office-links';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch virtual queue code
  const { data: virtualCode, error } = await supabase
    .from('virtual_queue_codes')
    .select('*')
    .eq('qr_token', token)
    .single();

  if (error || !virtualCode) {
    return NextResponse.json({ error: 'Invalid join code' }, { status: 404 });
  }

  if (!virtualCode.is_active) {
    return NextResponse.json({ error: 'This queue is temporarily closed' }, { status: 410 });
  }

  // Fetch organization
  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name, logo_url, settings')
    .eq('id', virtualCode.organization_id)
    .single();

  if (!organization) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  const _jiOrgSettings = ((organization.settings ?? {}) as Record<string, any>);
  if (_jiOrgSettings.virtual_queue_enabled === false) {
    return NextResponse.json({ error: 'Virtual queue is disabled' }, { status: 403 });
  }

  // Fetch offices — include settings so we can derive the public kiosk slug,
  // which lets mobile jump straight into the book-appointment flow.
  const { data: rawOffices } = await supabase
    .from('offices')
    .select('id, name, address, settings, timezone')
    .eq('organization_id', virtualCode.organization_id)
    .eq('is_active', true)
    .order('name');
  const offices = (rawOffices ?? []).map((o: any) => ({
    id: o.id,
    name: o.name,
    address: o.address,
    timezone: o.timezone ?? null,
    kiosk_slug: getOfficePublicSlug(o),
  }));

  // Fetch departments
  const officeIds = offices.map((o) => o.id);
  const { data: departments } = officeIds.length > 0
    ? await supabase
        .from('departments')
        .select('id, name, office_id')
        .in('office_id', officeIds)
        .eq('is_active', true)
        .order('sort_order')
    : { data: [] };

  // Fetch services
  const departmentIds = (departments ?? []).map((d) => d.id);
  const { data: services } = departmentIds.length > 0
    ? await supabase
        .from('services')
        .select('id, name, description, estimated_service_time, department_id')
        .in('department_id', departmentIds)
        .eq('is_active', true)
        .order('sort_order')
    : { data: [] };

  // Count waiting tickets
  const { data: waitingTickets } = officeIds.length > 0
    ? await supabase
        .from('tickets')
        .select('id, office_id, department_id, service_id')
        .in('office_id', officeIds)
        .eq('status', 'waiting')
    : { data: [] };

  return NextResponse.json({
    virtualCode: {
      id: virtualCode.id,
      office_id: virtualCode.office_id,
      department_id: virtualCode.department_id,
      service_id: virtualCode.service_id,
    },
    organization,
    offices,
    departments: departments ?? [],
    services: services ?? [],
    waitingTickets: (waitingTickets ?? []).map((t) => ({
      office_id: t.office_id,
      department_id: t.department_id,
      service_id: t.service_id,
    })),
  });
}
