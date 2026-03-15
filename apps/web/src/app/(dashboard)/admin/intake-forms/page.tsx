import { createClient } from '@/lib/supabase/server';
import { IntakeFormsClient } from './intake-forms-client';

export default async function IntakeFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  const { data: servicesData } = await supabase
    .from('services')
    .select('id, name, department_id, estimated_service_time, department:departments(id, name, office:offices(id, name))')
    .eq('is_active', true)
    .order('name');
  const services = servicesData || [];

  const serviceIds = services.map((service) => service.id);
  let fieldQuery = supabase
    .from('intake_form_fields')
    .select('id, service_id, field_label, field_name, field_type, is_required, options, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (params.service) {
    fieldQuery = fieldQuery.eq('service_id', params.service);
  } else if (serviceIds.length > 0) {
    fieldQuery = fieldQuery.in('service_id', serviceIds);
  }

  const { data: fieldsData, error } = await fieldQuery;
  const fields = fieldsData || [];

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load intake forms: {error.message}</p>
      </div>
    );
  }

  return (
    <IntakeFormsClient
      fields={fields}
      services={services as any}
      currentServiceFilter={params.service ?? ''}
    />
  );
}
