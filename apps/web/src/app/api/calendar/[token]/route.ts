import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

function formatIcsDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Missing calendar token' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: appointment, error } = await (supabase
    .from('appointments')
    .select(
      `*,
       service:services(name, estimated_service_time),
       department:departments(name),
       office:offices(name, organization:organizations(name))`
    ) as any)
    .eq('calendar_token', token)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }

  const office = appointment.office as { name: string; organization: { name: string } | null } | null;
  const service = appointment.service as { name: string; estimated_service_time: number | null } | null;
  const department = appointment.department as { name: string } | null;

  // ── JSON mode — for mobile app "My appointments" list, same token auth ──
  const wantsJson =
    request.nextUrl.searchParams.get('format') === 'json' ||
    (request.headers.get('accept') ?? '').includes('application/json');
  if (wantsJson) {
    return NextResponse.json({
      appointment: {
        id: appointment.id,
        status: appointment.status,
        scheduled_at: appointment.scheduled_at,
        customer_name: appointment.customer_name,
        customer_phone: appointment.customer_phone,
        notes: appointment.notes,
        calendar_token: appointment.calendar_token,
        office_id: appointment.office_id,
        department_id: appointment.department_id,
        service_id: appointment.service_id,
        business_name: office?.organization?.name ?? office?.name ?? null,
        office_name: office?.name ?? null,
        service_name: service?.name ?? null,
        department_name: department?.name ?? null,
      },
    });
  }

  const businessName = office?.organization?.name ?? office?.name ?? 'Business';
  const serviceName = service?.name ?? 'Service';
  const departmentName = department?.name ?? '';
  const locationName = office?.name ?? '';

  const dtStart = new Date(appointment.scheduled_at);
  const durationMinutes = service?.estimated_service_time ?? 30;
  const dtEnd = new Date(dtStart.getTime() + durationMinutes * 60 * 1000);

  const now = new Date();
  const uid = `${appointment.id}@qflow`;

  const description = [
    `Service: ${serviceName}`,
    departmentName ? `Department: ${departmentName}` : '',
    `Status: ${appointment.status}`,
  ]
    .filter(Boolean)
    .join('\\n');

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QFlow//Appointment//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(dtStart)}`,
    `DTEND:${formatIcsDate(dtEnd)}`,
    `SUMMARY:${escapeIcsText(`Appointment at ${businessName}`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(locationName)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return new NextResponse(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="appointment.ics"',
    },
  });
}
