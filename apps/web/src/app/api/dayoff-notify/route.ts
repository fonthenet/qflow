import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage, normalizePhone } from '@/lib/whatsapp';
import { sendSmsMessage, isSmsProviderConfigured } from '@/lib/sms';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const SEND_DELAY_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/dayoff-notify
 *
 * Notifies customers with appointments on the given dates that the business
 * will be closed. Sends via WhatsApp and optionally SMS.
 *
 * Auth: Bearer Supabase JWT
 *
 * Body: {
 *   officeId: string;
 *   dates: string[];        // YYYY-MM-DD array
 *   reason: string;         // e.g. "Public holiday"
 *   channels: { whatsapp?: boolean; sms?: boolean };
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    // ── Auth ──
    const authHeader = request.headers.get('authorization') ?? '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!bearerToken) return jsonResponse({ error: 'Missing bearer token' }, 401);

    const { data: { user } } = await supabase.auth.getUser(bearerToken);
    if (!user) return jsonResponse({ error: 'Invalid token' }, 401);

    const { data: staff } = await supabase
      .from('staff')
      .select('id, organization_id')
      .eq('auth_user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (!staff) return jsonResponse({ error: 'No staff record' }, 403);

    const orgId = (staff as any).organization_id as string;

    // ── Body ──
    const body = await request.json();
    const officeId: string = body.officeId;
    const dates: string[] = Array.isArray(body.dates) ? body.dates : [];
    const reason: string = (body.reason ?? '').toString().trim();
    const channels = body.channels ?? { whatsapp: true };

    if (!officeId || dates.length === 0) {
      return jsonResponse({ error: 'Missing officeId or dates' }, 400);
    }

    // Verify office belongs to org
    const { data: office } = await supabase
      .from('offices')
      .select('id, name, organization_id, organization:organizations(timezone)')
      .eq('id', officeId)
      .single();
    if (!office || (office as any).organization_id !== orgId) {
      return jsonResponse({ error: 'Office not found' }, 404);
    }

    const officeName = (office as any).name ?? '';
    // Use org-level timezone as single source of truth
    const officeTimezone = (office as any)?.organization?.timezone ?? 'Africa/Algiers';

    // Fetch org name
    const { data: org } = await supabase
      .from('organizations')
      .select('name, settings')
      .eq('id', orgId)
      .single();
    const orgName = (org as any)?.name ?? '';
    const orgSettings = (org as any)?.settings ?? {};
    const smsEnabled = !!orgSettings.priority_alerts_sms_enabled;

    // ── Find affected appointments ──
    // Build date range: start of first date to end of last date in office timezone
    const sortedDates = [...dates].sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];

    const { data: appointments, error: apptErr } = await supabase
      .from('appointments')
      .select('id, customer_name, customer_phone, customer_email, scheduled_at, status, locale')
      .eq('office_id', officeId)
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', `${startDate}T00:00:00`)
      .lte('scheduled_at', `${endDate}T23:59:59`)
      .not('customer_phone', 'is', null)
      .limit(500);

    if (apptErr) {
      return jsonResponse({ error: apptErr.message }, 500);
    }

    if (!appointments || appointments.length === 0) {
      return jsonResponse({ sent: 0, failed: 0, total: 0, reason: 'no appointments found' });
    }

    // Filter to only appointments on the specific dates
    const dateSet = new Set(dates);
    const affected = appointments.filter((a: any) => {
      const apptDate = a.scheduled_at?.split('T')[0];
      return apptDate && dateSet.has(apptDate);
    });

    if (affected.length === 0) {
      return jsonResponse({ sent: 0, failed: 0, total: 0, reason: 'no appointments on selected dates' });
    }

    // Deduplicate by phone number (same customer might have multiple appointments)
    const seen = new Set<string>();
    const recipients: Array<{ phone: string; name: string; locale: string; date: string }> = [];
    for (const a of affected as any[]) {
      const phone = a.customer_phone;
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      recipients.push({
        phone,
        name: a.customer_name ?? '',
        locale: a.locale ?? 'fr',
        date: a.scheduled_at?.split('T')[0] ?? '',
      });
    }

    // ── Build messages per locale ──
    const reasonText = reason || 'Day off';
    const messages: Record<string, string> = {
      fr: `📅 *${orgName}*\n\n⚠️ Nous vous informons que ${officeName ? `*${officeName}*` : 'notre bureau'} sera fermé le(s) jour(s) suivant(s) :\n\n📋 *Motif :* ${reasonText}\n\nVotre rendez-vous a été annulé. Veuillez reprogrammer à votre convenance.\n\nNous nous excusons pour le désagrément.`,
      ar: `📅 *${orgName}*\n\n⚠️ نعلمكم أن ${officeName ? `*${officeName}*` : 'مكتبنا'} سيكون مغلقاً في الأيام التالية:\n\n📋 *السبب:* ${reasonText}\n\nتم إلغاء موعدكم. يرجى إعادة الحجز في وقت لاحق.\n\nنعتذر عن أي إزعاج.`,
      en: `📅 *${orgName}*\n\n⚠️ We inform you that ${officeName ? `*${officeName}*` : 'our office'} will be closed on the following day(s):\n\n📋 *Reason:* ${reasonText}\n\nYour appointment has been cancelled. Please reschedule at your convenience.\n\nWe apologize for the inconvenience.`,
    };

    // ── Send notifications ──
    let whatsappSent = 0;
    let whatsappFailed = 0;
    let smsSent = 0;
    let smsFailed = 0;

    const doSms = channels.sms && smsEnabled && isSmsProviderConfigured();

    for (const r of recipients) {
      const msg = messages[r.locale] ?? messages.fr;
      const normalized = normalizePhone(r.phone, officeTimezone, null) ?? r.phone;

      // WhatsApp
      if (channels.whatsapp) {
        try {
          const result = await sendWhatsAppMessage({ to: normalized, body: msg });
          if (result.ok) whatsappSent++;
          else whatsappFailed++;
        } catch {
          whatsappFailed++;
        }
      }

      // SMS
      if (doSms) {
        try {
          const smsMsg = msg.replace(/\*/g, ''); // Strip markdown bold for SMS
          const result = await sendSmsMessage({ to: normalized, body: smsMsg });
          if (result.ok) smsSent++;
          else smsFailed++;
        } catch {
          smsFailed++;
        }
      }

      await sleep(SEND_DELAY_MS);
    }

    // ── Cancel the affected appointments ──
    const affectedIds = affected.map((a: any) => a.id);
    if (affectedIds.length > 0) {
      await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .in('id', affectedIds);
    }

    return jsonResponse({
      total: recipients.length,
      whatsapp: { sent: whatsappSent, failed: whatsappFailed },
      sms: doSms ? { sent: smsSent, failed: smsFailed } : undefined,
      cancelled: affectedIds.length,
    });
  } catch (err: any) {
    console.error('[dayoff-notify] Error:', err?.message ?? err);
    return jsonResponse({ error: err?.message ?? 'Internal error' }, 500);
  }
}
