'use server';

import { TICKET_EVENT_TYPES } from '@qflo/shared';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasVerifiedBookingEmail } from '@/lib/booking-email-otp';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { sendWhatsAppMessage, normalizePhone } from '@/lib/whatsapp';
import { getQueuePosition } from '@/lib/queue-position';
import { t as tMsg, type Locale } from '@/lib/messaging-commands';
import { trackUrl as buildTrackUrl } from '@/lib/config';


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
    // Day resolution: dateKey → day name (timezone-safe, deterministic)
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: normalizedTimezone }).format(now);
    const d = new Date(dateKey + 'T12:00:00Z');
    day = DAYS_OF_WEEK[d.getUTCDay()];

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
    // Fallback: use UTC noon dateKey approach — safer than raw getUTCDay()
    const fallbackKey = now.toISOString().split('T')[0];
    const fd = new Date(fallbackKey + 'T12:00:00Z');
    day = DAYS_OF_WEEK[fd.getUTCDay()];
    time = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
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
  locale?: string | null;
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
  let status: string = input.status ?? 'waiting';

  const { data: office, error: officeError } = await supabase
    .from('offices')
    .select('id, organization_id, settings, operating_hours, timezone, organization:organizations(settings, timezone)')
    .eq('id', input.officeId)
    .single();

  if (officeError || !office) {
    return { error: officeError?.message ?? 'Office not found' };
  }

  // Use org-level timezone as single source of truth
  const orgTz = (office.organization as any)?.timezone || office.timezone || 'Africa/Algiers';
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
    const businessHoursStatus = getBusinessHoursStatus(operatingHours, orgTz);

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

  // ── Ban check ──────────────────────────────────────────────────────
  const orgId = (office as any).organization_id as string | undefined;
  if (orgId && input.customerData) {
    const cd = input.customerData as Record<string, unknown>;
    const phone = typeof cd.phone === 'string' ? cd.phone : null;
    const email = typeof cd.email === 'string' ? cd.email : null;
    const psid = typeof cd.messenger_psid === 'string' ? cd.messenger_psid : null;

    if (phone || email || psid) {
      const { data: banned } = await (supabase as any).rpc('is_customer_banned', {
        p_org_id: orgId,
        p_phone: phone,
        p_email: email,
        p_psid: psid,
      });
      if (banned) {
        return { error: 'You are not allowed to join this queue.' };
      }
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

  // ── Same-day ticket approval gating ──────────────────────────────
  // If the office enables `require_ticket_approval`, tickets from public
  // channels (WhatsApp, Messenger, kiosk, mobile app, QR code) are held
  // in `pending_approval` state until a provider approves them via Station.
  // Provider-originated sources (`in_house`, `appointment`) always bypass.
  const requireApproval = Boolean(
    officeSettings.require_ticket_approval ?? organizationSettings.require_ticket_approval
  );
  const providerOriginated = input.source === 'in_house' || input.source === 'appointment';
  if (requireApproval && !providerOriginated && input.status === undefined) {
    status = 'pending_approval';
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
      locale: input.locale ?? null,
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

    // Session creation is handled by the Postgres trigger on ticket INSERT.
    // We send the "joined" message directly here to capture the result for operator feedback.
    // The trigger's async send will be duplicate-suppressed by the 60s dedup window.
  }

  // Send WhatsApp "joined" notification and capture result for feedback
  // Skip if ticket was created via WhatsApp/Messenger — the webhook handler sends its own formatted message
  let whatsappStatus: { sent: boolean; error?: string } = { sent: false };
  const isMessagingSource = input.source === 'whatsapp' || input.source === 'messenger';
  const rawPhone = typeof input.customerData?.phone === 'string' ? (input.customerData.phone as string).trim() : null;
  if (ticket && rawPhone && !isMessagingSource) {
    const officeCC = (office.settings as Record<string, unknown> | null)?.country_code as string | undefined;
    const normalizedPhone = normalizePhone(rawPhone, orgTz, officeCC);
    if (normalizedPhone) {
      try {
        // Prefer the locale stored on the ticket itself (set at creation
        // from the chat session). Fall back to 'fr' if missing.
        let locale: Locale = ((ticket as any)?.locale as Locale) || 'fr';
        let orgName = '';
        try {
          if (orgId) {
            const { data: orgRow } = await (supabase as any)
              .from('organizations')
              .select('name')
              .eq('id', orgId)
              .single();
            orgName = orgRow?.name ?? '';
          }
        } catch {}
        const trackUrl = buildTrackUrl(ticket.qr_token);
        const body = tMsg('joined', locale, {
          name: orgName,
          ticket: ticket.ticket_number,
          position: '',
          now_serving: '',
          url: trackUrl,
        });
        const waResult = await sendWhatsAppMessage({
          to: normalizedPhone,
          body,
        });
        whatsappStatus = { sent: waResult.ok, error: waResult.ok ? undefined : (waResult.error ?? 'Unknown error') };
      } catch (err: any) {
        whatsappStatus = { sent: false, error: err?.message ?? 'Send failed' };
      }
    } else {
      whatsappStatus = { sent: false, error: 'Invalid phone number' };
    }
  }

  // Calculate queue position for confirmation screen (priority-aware)
  let position_in_queue: number | null = null;
  let estimated_wait: number | null = ticket?.estimated_wait_minutes ?? null;
  if (ticket) {
    const pos = await getQueuePosition(ticket.id);
    position_in_queue = pos.position;
    estimated_wait = pos.estimated_wait_minutes ?? estimated_wait;
  }

  revalidatePath('/desk');
  return { data: ticket ? { ...ticket, position_in_queue, estimated_wait } : ticket, whatsappStatus };
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
