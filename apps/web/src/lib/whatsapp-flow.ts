import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAvailableDates, getAvailableSlots } from '@/lib/slot-generator';
import { WILAYAS } from '@/lib/wilayas';
import { normalizePhone } from '@/lib/whatsapp';

// ── Types ──────────────────────────────────────────────────────────

interface FlowSlot {
  id: string;     // "svcId|deptId|YYYY-MM-DD|HH:MM"
  title: string;  // "Consultation — mar. 15 avr. — 09:00"
}

interface FlowBookingData {
  slot: string;
  ctx: string;           // "orgId|officeId|locale"
  customer_name: string;
  wilaya?: string;
  reason?: string;
}

type Locale = 'fr' | 'ar' | 'en';

// ── Localized labels ───────────────────────────────────────────────

const LABELS: Record<Locale, {
  subheading: string;
  slot_label: string;
  next_label: string;
  confirm_heading: string;
  name_label: string;
  name_hint: string;
  wilaya_label: string;
  reason_label: string;
  confirm_label: string;
  body_text: string;
  cta: string;
  slot_taken: string;
  booking_error: string;
}> = {
  fr: {
    subheading: 'Choisissez un créneau disponible',
    slot_label: 'Créneaux disponibles',
    next_label: 'Suivant',
    confirm_heading: 'Vos coordonnées',
    name_label: 'Nom complet',
    name_hint: 'ex : Ahmed Ben Ali',
    wilaya_label: 'Wilaya (optionnel)',
    reason_label: 'Motif de la visite (optionnel)',
    confirm_label: 'Confirmer la réservation',
    body_text: '📅 Réservez votre rendez-vous en quelques secondes',
    cta: 'Réserver',
    slot_taken: '⚠️ Désolé, ce créneau vient d\'être pris. Veuillez réessayer avec *RDV*.',
    booking_error: '❌ Une erreur est survenue. Veuillez réessayer plus tard.',
  },
  ar: {
    subheading: 'اختر موعداً متاحاً',
    slot_label: 'المواعيد المتاحة',
    next_label: 'التالي',
    confirm_heading: 'معلوماتك',
    name_label: 'الاسم الكامل',
    name_hint: 'مثال: أحمد بن علي',
    wilaya_label: 'الولاية (اختياري)',
    reason_label: 'سبب الزيارة (اختياري)',
    confirm_label: 'تأكيد الحجز',
    body_text: '📅 احجز موعدك في ثوانٍ',
    cta: 'احجز الآن',
    slot_taken: '⚠️ عذراً، تم حجز هذا الموعد. يرجى المحاولة مرة أخرى بإرسال *موعد*.',
    booking_error: '❌ حدث خطأ. يرجى المحاولة لاحقاً.',
  },
  en: {
    subheading: 'Choose an available time slot',
    slot_label: 'Available slots',
    next_label: 'Next',
    confirm_heading: 'Your information',
    name_label: 'Full name',
    name_hint: 'e.g. Ahmed Ben Ali',
    wilaya_label: 'Province (optional)',
    reason_label: 'Reason for visit (optional)',
    confirm_label: 'Confirm booking',
    body_text: '📅 Book your appointment in seconds',
    cta: 'Book Now',
    slot_taken: '⚠️ Sorry, this slot was just taken. Please try again with *BOOK*.',
    booking_error: '❌ An error occurred. Please try again later.',
  },
};

// Confirmation message templates (mirrors messaging-commands.ts)
const CONFIRM_MSG: Record<'confirmed' | 'pending', Record<Locale, string>> = {
  confirmed: {
    fr: '✅ *Réservation confirmée !*\n\n🏢 *{name}*\n📅 *{date}* à *{time}*\n👤 *{customer}*\n\nVous recevrez un rappel 1h avant votre rendez-vous.\n\nPour annuler, envoyez *ANNULER RDV*.',
    ar: '✅ *تم تأكيد الحجز !*\n\n🏢 *{name}*\n📅 *{date}* الساعة *{time}*\n👤 *{customer}*\n\nستصلك رسالة تذكير قبل ساعة من موعدك.\n\nللإلغاء، أرسل *الغاء موعد*',
    en: '✅ *Booking confirmed!*\n\n🏢 *{name}*\n📅 *{date}* at *{time}*\n👤 *{customer}*\n\nYou\'ll receive a reminder 1 hour before.\n\nTo cancel, send *CANCEL BOOKING*.',
  },
  pending: {
    fr: '⏳ *Demande de réservation reçue*\n\n🏢 *{name}*\n📅 *{date}* à *{time}*\n👤 *{customer}*\n\nVotre créneau est *réservé* en attente de validation.\n\nPour annuler, envoyez *ANNULER RDV*.',
    ar: '⏳ *تم استلام طلب الحجز*\n\n🏢 *{name}*\n📅 *{date}* الساعة *{time}*\n👤 *{customer}*\n\nموعدك *محجوز* في انتظار موافقة المزود.\n\nللإلغاء، أرسل *الغاء موعد*',
    en: '⏳ *Booking request received*\n\n🏢 *{name}*\n📅 *{date}* at *{time}*\n👤 *{customer}*\n\nYour slot is *reserved* pending provider approval.\n\nTo cancel, send *CANCEL BOOKING*.',
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

function formatSlotDate(dateStr: string, locale: Locale): string {
  const date = new Date(dateStr + 'T12:00:00Z');
  const lang = locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-FR' : 'en-GB';
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function buildWilayasData(locale: Locale): { id: string; title: string }[] {
  return WILAYAS.map(w => ({
    id: `${String(w.code).padStart(2, '0')}-${w.name}`,
    title: locale === 'ar'
      ? `${String(w.code).padStart(2, '0')} - ${w.name_ar}`
      : `${String(w.code).padStart(2, '0')} - ${w.name}`,
  }));
}

function replaceVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

// ── Fetch all available slots for an office ─────────────────────────

const MAX_SLOTS = 100;

export async function fetchBookingSlots(
  officeId: string,
  services: { id: string; name: string; department_id: string }[],
  locale: Locale,
): Promise<FlowSlot[]> {
  const multiService = services.length > 1;
  const allSlots: FlowSlot[] = [];

  for (const svc of services) {
    if (allSlots.length >= MAX_SLOTS) break;

    const dates = await getAvailableDates(officeId, svc.id);

    for (const { date } of dates) {
      if (allSlots.length >= MAX_SLOTS) break;

      const result = await getAvailableSlots({ officeId, serviceId: svc.id, date });

      for (const slot of result.slots) {
        if (allSlots.length >= MAX_SLOTS) break;

        const dateFormatted = formatSlotDate(date, locale);
        const title = multiService
          ? `${svc.name} — ${dateFormatted} — ${slot.time}`
          : `${dateFormatted} — ${slot.time}`;

        allSlots.push({
          id: `${svc.id}|${svc.department_id}|${date}|${slot.time}`,
          title,
        });
      }
    }
  }

  return allSlots;
}

// ── Send booking flow message ──────────────────────────────────────

export async function sendBookingFlowMessage(
  to: string,
  org: { id: string; name: string },
  officeId: string,
  slots: FlowSlot[],
  locale: Locale,
): Promise<{ ok: boolean; error?: string }> {
  const flowId = process.env.WHATSAPP_FLOW_ID?.trim();
  const accessToken = process.env.WHATSAPP_META_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_META_PHONE_NUMBER_ID?.trim();

  if (!flowId || !accessToken || !phoneNumberId) {
    return { ok: false, error: 'WhatsApp Flow not configured' };
  }

  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) {
    return { ok: false, error: 'Invalid phone number' };
  }

  const labels = LABELS[locale] || LABELS.fr;
  const ctx = `${org.id}|${officeId}|${locale}`;
  const wilayas = buildWilayasData(locale);

  const flowData = {
    ctx,
    heading: org.name,
    subheading: labels.subheading,
    slot_label: labels.slot_label,
    slots,
    next_label: labels.next_label,
    confirm_heading: labels.confirm_heading,
    name_label: labels.name_label,
    name_hint: labels.name_hint,
    wilaya_label: labels.wilaya_label,
    reason_label: labels.reason_label,
    confirm_label: labels.confirm_label,
    wilayas,
  };

  const response = await fetch(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'interactive',
        interactive: {
          type: 'flow',
          body: { text: labels.body_text },
          action: {
            name: 'flow',
            parameters: {
              flow_id: flowId,
              flow_cta: labels.cta,
              flow_action: 'navigate',
              flow_action_payload: {
                screen: 'SELECT_SLOT',
                data: flowData,
              },
              flow_message_version: '3',
              flow_token: ctx,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const errorMsg = data?.error?.message || `HTTP ${response.status}`;
    console.error('[whatsapp-flow] Failed to send flow:', errorMsg);
    return { ok: false, error: errorMsg };
  }

  return { ok: true };
}

// ── Handle nfm_reply (flow completion) ─────────────────────────────

export async function handleFlowBookingReply(
  responseJson: string,
  fromPhone: string,
  _bsuid?: string,
): Promise<void> {
  let parsed: FlowBookingData;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    console.error('[whatsapp-flow] Failed to parse response_json');
    return;
  }

  const { slot, ctx, customer_name, wilaya, reason } = parsed;
  if (!slot || !ctx || !customer_name) {
    console.error('[whatsapp-flow] Missing required fields:', { slot: !!slot, ctx: !!ctx, customer_name: !!customer_name });
    return;
  }

  // Parse ctx: "orgId|officeId|locale"
  const ctxParts = ctx.split('|');
  if (ctxParts.length < 3) {
    console.error('[whatsapp-flow] Invalid ctx:', ctx);
    return;
  }
  const orgId = ctxParts[0];
  const officeId = ctxParts[1];
  const locale = (ctxParts[2] || 'fr') as Locale;

  // Parse slot: "svcId|deptId|date|time"
  const slotParts = slot.split('|');
  if (slotParts.length < 4) {
    console.error('[whatsapp-flow] Invalid slot:', slot);
    return;
  }
  const serviceId = slotParts[0];
  const departmentId = slotParts[1];
  const date = slotParts[2];
  const time = slotParts[3];

  const scheduledAt = `${date}T${time}:00`;
  const identifier = fromPhone;
  const labels = LABELS[locale] || LABELS.fr;

  const supabase = createAdminClient() as any;

  // Fetch org for approval gate + name
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('name, settings')
    .eq('id', orgId)
    .single();

  if (!orgRow) {
    console.error('[whatsapp-flow] Organization not found:', orgId);
    return;
  }

  const requireApproval = Boolean(
    (orgRow.settings as any)?.require_appointment_approval ?? true,
  );
  const initialStatus = requireApproval ? 'pending' : 'confirmed';

  const { nanoid } = await import('nanoid');
  const calendarToken = nanoid(16);

  // Parse wilaya from "16-Alger" → "Alger"
  const wilayaName = wilaya
    ? wilaya.replace(/^\d+-/, '') || wilaya
    : null;

  const { data: _appointment, error } = await supabase
    .from('appointments')
    .insert({
      office_id: officeId,
      department_id: departmentId,
      service_id: serviceId,
      customer_name: customer_name.trim(),
      customer_phone: identifier,
      scheduled_at: scheduledAt,
      status: initialStatus,
      calendar_token: calendarToken,
      wilaya: wilayaName,
      notes: reason?.trim() || null,
      locale,
      source: 'whatsapp',
    })
    .select('id')
    .single();

  const { sendWhatsAppMessage } = await import('@/lib/whatsapp');

  if (error) {
    const code = (error as any).code;
    const msg = error.message || '';
    const slotTaken =
      code === '23505' ||
      msg.includes('slot_full') ||
      msg.includes('uniq_appointments_active_slot') ||
      msg.includes('fully booked');

    if (slotTaken) {
      console.warn('[whatsapp-flow] Slot taken (race):', msg);
      await sendWhatsAppMessage({ to: identifier, body: labels.slot_taken });
    } else {
      console.error('[whatsapp-flow] Appointment insert failed:', msg);
      await sendWhatsAppMessage({ to: identifier, body: labels.booking_error });
    }
    return;
  }

  // Upsert customer (non-fatal)
  try {
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .eq('phone', identifier)
      .maybeSingle();

    if (existing) {
      await supabase.from('customers').update({
        name: customer_name.trim(),
        last_booking_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('customers').insert({
        organization_id: orgId,
        name: customer_name.trim(),
        phone: identifier,
        source: 'whatsapp',
        last_booking_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn('[whatsapp-flow] Customer upsert failed (non-fatal):', e);
  }

  // Send confirmation
  const dateFormatted = formatSlotDate(date, locale);
  const templateKey = requireApproval ? 'pending' : 'confirmed';
  const confirmBody = replaceVars(CONFIRM_MSG[templateKey][locale], {
    name: orgRow.name,
    date: dateFormatted,
    time,
    customer: customer_name.trim(),
  });

  await sendWhatsAppMessage({ to: identifier, body: confirmBody });
}

// ── Flow JSON for Meta setup ───────────────────────────────────────
// Upload this JSON to Meta via the setup script to create the Flow.

export function buildBookingFlowJson(): object {
  return {
    version: '6.0',
    screens: [
      {
        id: 'SELECT_SLOT',
        title: 'Book Appointment',
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'TextHeading',
              text: '${data.heading}',
            },
            {
              type: 'TextBody',
              text: '${data.subheading}',
            },
            {
              type: 'RadioButtonsGroup',
              name: 'slot',
              label: '${data.slot_label}',
              required: true,
              'data-source': '${data.slots}',
            },
            {
              type: 'Footer',
              label: '${data.next_label}',
              'on-click-action': {
                name: 'navigate',
                next: { type: 'screen', name: 'CUSTOMER_INFO' },
                payload: {
                  slot: '${form.slot}',
                  ctx: '${data.ctx}',
                  heading: '${data.confirm_heading}',
                  name_label: '${data.name_label}',
                  name_hint: '${data.name_hint}',
                  wilaya_label: '${data.wilaya_label}',
                  reason_label: '${data.reason_label}',
                  confirm_label: '${data.confirm_label}',
                  wilayas: '${data.wilayas}',
                },
              },
            },
          ],
        },
        data: {
          ctx: { type: 'string', __example__: 'org-id|office-id|fr' },
          heading: { type: 'string', __example__: 'Clinic Name' },
          subheading: { type: 'string', __example__: 'Choose a slot' },
          slot_label: { type: 'string', __example__: 'Available slots' },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['id', 'title'],
            },
            __example__: [{ id: 'svc|dept|2026-04-15|09:00', title: 'Apr 15 — 09:00' }],
          },
          next_label: { type: 'string', __example__: 'Next' },
          confirm_heading: { type: 'string', __example__: 'Your info' },
          name_label: { type: 'string', __example__: 'Full name' },
          name_hint: { type: 'string', __example__: 'e.g. Ahmed Ben Ali' },
          wilaya_label: { type: 'string', __example__: 'Province' },
          reason_label: { type: 'string', __example__: 'Reason' },
          confirm_label: { type: 'string', __example__: 'Confirm' },
          wilayas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['id', 'title'],
            },
            __example__: [{ id: '16-Alger', title: '16 - Alger' }],
          },
        },
      },
      {
        id: 'CUSTOMER_INFO',
        title: 'Your Information',
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'TextHeading',
              text: '${data.heading}',
            },
            {
              type: 'TextInput',
              name: 'customer_name',
              label: '${data.name_label}',
              'helper-text': '${data.name_hint}',
              required: true,
              'input-type': 'text',
              'min-chars': 2,
              'max-chars': 100,
            },
            {
              type: 'Dropdown',
              name: 'wilaya',
              label: '${data.wilaya_label}',
              required: false,
              'data-source': '${data.wilayas}',
            },
            {
              type: 'TextArea',
              name: 'reason',
              label: '${data.reason_label}',
              required: false,
              'max-length': 200,
            },
            {
              type: 'Footer',
              label: '${data.confirm_label}',
              'on-click-action': {
                name: 'complete',
                payload: {
                  slot: '${data.slot}',
                  ctx: '${data.ctx}',
                  customer_name: '${form.customer_name}',
                  wilaya: '${form.wilaya}',
                  reason: '${form.reason}',
                },
              },
            },
          ],
        },
        data: {
          slot: { type: 'string', __example__: 'svc|dept|2026-04-15|09:00' },
          ctx: { type: 'string', __example__: 'org-id|office-id|fr' },
          heading: { type: 'string', __example__: 'Your info' },
          name_label: { type: 'string', __example__: 'Full name' },
          name_hint: { type: 'string', __example__: 'e.g. Ahmed' },
          wilaya_label: { type: 'string', __example__: 'Province' },
          reason_label: { type: 'string', __example__: 'Reason' },
          confirm_label: { type: 'string', __example__: 'Confirm' },
          wilayas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['id', 'title'],
            },
            __example__: [{ id: '16-Alger', title: '16 - Alger' }],
          },
        },
      },
    ],
  };
}
