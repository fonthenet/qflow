import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BookingsHistory } from '@/components/admin/bookings-history';
import { SlotManager } from '@/components/admin/slot-manager';

export default async function AdminBookingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  // Fetch org settings
  const { data: org } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', staff.organization_id)
    .single();

  const orgSettings = (org?.settings as Record<string, any> | null) ?? {};

  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, is_active, settings, operating_hours')
    .eq('organization_id', staff.organization_id)
    .order('name');

  const officeIds = (offices ?? []).map((office) => office.id);

  const { data: departments } = officeIds.length
    ? await supabase
        .from('departments')
        .select(
          'id, name, code, office_id, is_active, sort_order, services(id, name, code, department_id, is_active, sort_order)'
        )
        .in('office_id', officeIds)
        .order('sort_order')
    : { data: [] as any[] };

  const historyWindowStart = new Date();
  historyWindowStart.setDate(historyWindowStart.getDate() - 90);

  const { data: appointments } = officeIds.length
    ? await supabase
        .from('appointments')
        .select(
          'id, office_id, department_id, service_id, customer_name, customer_phone, customer_email, scheduled_at, created_at, status, ticket_id'
        )
        .in('office_id', officeIds)
        .gte('scheduled_at', historyWindowStart.toISOString())
        .order('scheduled_at', { ascending: false })
        .limit(500)
    : { data: [] as any[] };

  const ticketIds = (appointments ?? [])
    .map((appointment) => appointment.ticket_id)
    .filter((ticketId): ticketId is string => typeof ticketId === 'string');

  const { data: tickets } = ticketIds.length
    ? await supabase
        .from('tickets')
        .select('id, ticket_number, qr_token, status')
        .in('id', ticketIds)
    : { data: [] as any[] };

  const ticketMap = new Map((tickets ?? []).map((ticket) => [ticket.id, ticket]));
  const hydratedAppointments = (appointments ?? []).map((appointment) => ({
    ...appointment,
    ticket: appointment.ticket_id ? ticketMap.get(appointment.ticket_id) ?? null : null,
  }));

  return (
    <div className="space-y-6">
      <BookingsHistory
        offices={offices ?? []}
        departments={departments ?? []}
        appointments={hydratedAppointments}
      />
      {orgSettings.booking_mode !== 'disabled' && (
        <div className="px-6 pb-6">
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-lg font-semibold text-foreground">Manage Slots</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Block or unblock time slots for specific dates. Blocked slots won&apos;t be available for booking.
              </p>
            </div>
            <div className="p-5">
              <SlotManager offices={offices ?? []} orgSettings={orgSettings} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
