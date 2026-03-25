'use server';

import { TICKET_EVENT_TYPES } from '@queueflow/shared';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasVerifiedBookingEmail } from '@/lib/booking-email-otp';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { resolvePlatformConfig } from '@/lib/platform/config';

const DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function normalizeOfficeTimezone(timezone: string | null | undefined) {
  const value = (timezone ?? '').trim();
  if (!value) return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (value === 'Europe/Algiers') return 'Africa/Algiers';
  return value;
}

function getBusinessHoursStatus(
  operatingHours: Record<string, { open: string; close: string }> | null,
  timezone: string | null | undefined
) {
  const now = new Date();
  const normalizedTimezone = normalizeOfficeTimezone(timezone);
  let day: string;
  let time: string;

  try {
    const dayFmt = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: normalizedTimezone,
    });
    day = dayFmt.format(now).toLowerCase();

    const timeFmt = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: normalizedTimezone,
    });
    const parts = timeFmt.formatToParts(now);
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  } catch {
    day = DAYS_OF_WEEK[now.getDay()];
    time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  if (!operatingHours || Object.keys(operatingHours).length === 0) {
    return {
      isOpen: true,
      reason: 'no_hours',
      todayHours: null as { open: string; close: string } | null,
    };
  }

  const todayHours = operatingHours[day];
  if (!todayHours || (todayHours.open === '00:00' && todayHours.close === '00:00')) {
    return {
      isOpen: false,
      reason: 'closed_today',
      todayHours: null as { open: string; close: string } | null,
    };
  }

  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const currentMinutes = toMinutes(time);
  const openMinutes = toMinutes(todayHours.open);
  const closeMinutes = toMinutes(todayHours.close);

  if (currentMinutes < openMinutes) {
    return {
      isOpen: false,
      reason: 'before_hours',
      todayHours,
    };
  }

  if (currentMinutes >= closeMinutes) {
    return {
      isOpen: false,
      reason: 'after_hours',
      todayHours,
    };
  }

  return {
    isOpen: true,
    reason: 'open',
    todayHours,
  };
}

interface CreatePublicTicketInput {
  officeId: string;
  departmentId: string;
  serviceId: string;
  customerData?: Record<string, unknown> | null;
  status?: 'issued' | 'waiting';
  checkedInAt?: string;
  estimatedWaitMinutes?: number | null;
  isRemote?: boolean;
  source?: string;
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

export async function createPublicTicket(input: CreatePublicTicketInput) {
  const supabase = createAdminClient();
  const status = input.status ?? 'waiting';

  const { data: office, error: officeError } = await supabase
    .from('offices')
    .select('id, settings, operating_hours, timezone, organization:organizations(settings)')
    .eq('id', input.officeId)
    .single();

  if (officeError || !office) {
    return { error: officeError?.message ?? 'Office not found' };
  }

  const organizationSettings =
    ((office.organization as { settings?: Record<string, unknown> | null } | null)?.settings as
      | Record<string, unknown>
      | undefined) ?? {};
  const officeSettings = (office.settings as Record<string, unknown> | null) ?? {};
  const platformConfig = resolvePlatformConfig({
    organizationSettings,
    officeSettings,
  });
  const visitIntakeOverrideMode =
    (typeof organizationSettings.visit_intake_override_mode === 'string'
      ? organizationSettings.visit_intake_override_mode
      : typeof officeSettings.visit_intake_override_mode === 'string'
        ? officeSettings.visit_intake_override_mode
        : 'business_hours') as 'business_hours' | 'always_open' | 'always_closed';

  if (visitIntakeOverrideMode === 'always_closed') {
    return { error: 'This business is not taking visits right now.' };
  }

  if (visitIntakeOverrideMode === 'business_hours') {
    const operatingHours =
      (office.operating_hours as Record<string, { open: string; close: string }> | null) ?? null;
    const businessHoursStatus = getBusinessHoursStatus(operatingHours, office.timezone);

    if (!businessHoursStatus.isOpen) {
      if (businessHoursStatus.reason === 'before_hours') {
        return {
          error: `Opens at ${businessHoursStatus.todayHours?.open ?? ''}`.trim(),
        };
      }

      if (businessHoursStatus.reason === 'after_hours') {
        return { error: 'Closed for the day' };
      }

      if (businessHoursStatus.reason === 'closed_today') {
        return { error: 'Closed today' };
      }

      return { error: 'This business is not taking visits right now.' };
    }
  }

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
      source: input.source ?? (input.isRemote ? 'qr_code' : 'walk_in'),
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
        visitIntakeOverrideMode,
        templateId: platformConfig.template.id,
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
