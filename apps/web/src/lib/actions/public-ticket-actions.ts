'use server';

import { TICKET_EVENT_TYPES, isOfficeOpen, type OperatingHours } from '@queueflow/shared';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasVerifiedBookingEmail } from '@/lib/booking-email-otp';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';

interface CreatePublicTicketInput {
  officeId: string;
  departmentId: string;
  serviceId: string;
  customerData?: Record<string, unknown> | null;
  status?: 'issued' | 'waiting';
  checkedInAt?: string;
  estimatedWaitMinutes?: number | null;
  isRemote?: boolean;
  priority?: number | null;
  priorityCategoryId?: string | null;
  groupId?: string | null;
}

export async function getPublicIntakeFields(serviceId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('intake_form_fields')
    .select('*')
    .eq('service_id', serviceId)
    .order('sort_order', { ascending: true });

  if (error) {
    return { error: error.message };
  }

  return { data: data ?? [] };
}

export async function estimatePublicWaitTime(departmentId: string, serviceId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('estimate_wait_time', {
    p_department_id: departmentId,
    p_service_id: serviceId,
  });

  if (error) {
    return { error: error.message };
  }

  return { data: data ?? null };
}

// Station-online guard for ticket creation
const STATION_ONLINE_STALE_MS = 90_000;

async function getStationInfoForOffice(officeId: string): Promise<{ online: boolean; localUrl?: string }> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STATION_ONLINE_STALE_MS).toISOString();
  const { data } = await (admin as any)
    .from('desktop_connections')
    .select('id')
    .eq('office_id', officeId)
    .eq('is_online', true)
    .gte('last_ping', cutoff)
    .limit(1);
  const online = !!(data && (data as any[]).length > 0);
  if (!online) return { online: false };
  // Get the station's local URL from office settings
  const { data: office } = await admin
    .from('offices')
    .select('settings')
    .eq('id', officeId)
    .single();
  const settings = (office?.settings ?? {}) as Record<string, unknown>;
  const localUrl = typeof settings.station_local_url === 'string' ? settings.station_local_url : undefined;
  return { online: true, localUrl };
}

export async function checkStationForOffice(officeId: string) {
  return getStationInfoForOffice(officeId);
}

export async function createPublicTicket(input: CreatePublicTicketInput) {
  const supabase = createAdminClient();
  const status = input.status ?? 'waiting';

  // Block ticket creation when a local station is online
  const stationInfo = await getStationInfoForOffice(input.officeId);
  if (stationInfo.online) {
    const kioskHint = stationInfo.localUrl ? ` Use the lobby kiosk or visit ${stationInfo.localUrl}` : '';
    return { error: `Queue is managed by the local station.${kioskHint}`, stationOnline: true, stationUrl: stationInfo.localUrl };
  }

  const { data: office, error: officeError } = await supabase
    .from('offices')
    .select('id, operating_hours, timezone, organization:organizations(settings)')
    .eq('id', input.officeId)
    .single();

  if (officeError || !office) {
    return { error: officeError?.message ?? 'Office not found' };
  }

  // ── Business hours enforcement — reject same-day queue if closed ──
  const opHours = office.operating_hours as OperatingHours | null;
  if (opHours && Object.keys(opHours).length > 0) {
    const bh = isOfficeOpen(opHours, office.timezone || 'UTC');
    if (!bh.isOpen) {
      const reason = bh.reason === 'holiday' && bh.holidayName
        ? `This location is closed for ${bh.holidayName}`
        : bh.reason === 'before_hours' && bh.todayHours
        ? `This location opens at ${bh.todayHours.open}`
        : 'This location is currently closed';
      return { error: reason };
    }
  }

  const organizationSettings =
    ((office.organization as { settings?: Record<string, unknown> | null } | null)?.settings as
      | Record<string, unknown>
      | undefined) ?? {};
  const emailOtpEnabled = Boolean(organizationSettings.email_otp_enabled);
  const emailOtpRequiredForBooking = Boolean(
    organizationSettings.email_otp_required_for_booking
  );

  if (emailOtpEnabled && emailOtpRequiredForBooking) {
    const customerEmail =
      typeof input.customerData?.email === 'string'
        ? input.customerData.email.trim().toLowerCase()
        : '';

    if (!customerEmail) {
      return { error: 'Email verification is required before joining this queue.' };
    }

    const verified = await hasVerifiedBookingEmail({
      email: customerEmail,
      officeId: input.officeId,
    });

    if (!verified) {
      return { error: 'Please verify your email before joining the queue.' };
    }
  }

  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: input.departmentId }
  );

  if (seqError || !seqData || seqData.length === 0) {
    return { error: seqError?.message ?? 'Failed to generate ticket number' };
  }

  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);
  const waitResult =
    input.estimatedWaitMinutes !== undefined
      ? { data: input.estimatedWaitMinutes }
      : await estimatePublicWaitTime(input.departmentId, input.serviceId);

  if ('error' in waitResult) {
    return { error: waitResult.error };
  }

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      office_id: input.officeId,
      department_id: input.departmentId,
      service_id: input.serviceId,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status,
      checked_in_at: input.checkedInAt ?? new Date().toISOString(),
      customer_data: (input.customerData ?? null) as any,
      estimated_wait_minutes: waitResult.data ?? null,
      is_remote: input.isRemote ?? false,
      priority: input.priority ?? 0,
      priority_category_id: input.priorityCategoryId ?? null,
      group_id: input.groupId ?? null,
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  if (ticket) {
    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: TICKET_EVENT_TYPES.JOINED,
      to_status: ticket.status,
      metadata: {
        source: input.isRemote ? 'remote_join' : 'public_join',
      },
    });
  }

  revalidatePath('/desk');
  return { data: ticket };
}

export async function completePublicCheckIn(
  ticketId: string,
  customerData: Record<string, string | boolean> | null
) {
  const supabase = createAdminClient();
  const { data: ticket, error } = await supabase
    .from('tickets')
    .update({
      customer_data: customerData as any,
      status: 'waiting',
      checked_in_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  if (ticket) {
    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: TICKET_EVENT_TYPES.CHECKED_IN,
      from_status: 'issued',
      to_status: 'waiting',
      metadata: {
        source: 'public_check_in',
      },
    });
  }

  return { data: ticket };
}
