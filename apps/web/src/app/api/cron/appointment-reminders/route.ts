import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Hourly cron: send WhatsApp reminders for appointments scheduled
 * approximately 24 hours from now (within a 1-hour window).
 *
 * Vercel Cron: configured in /apps/web/vercel.json
 * Runs every hour at :00
 */
export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron (or has valid auth)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Window: appointments scheduled between 24h and 25h from now
  const now = new Date();
  const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const { data: appointments, error } = await (supabase as any)
    .from('appointments')
    .select(
      'id, customer_name, customer_phone, scheduled_at, office_id, service_id, reminder_sent, offices(name, organizations(name))'
    )
    .gte('scheduled_at', windowStart.toISOString())
    .lt('scheduled_at', windowEnd.toISOString())
    .in('status', ['pending', 'confirmed'])
    .or('reminder_sent.is.null,reminder_sent.eq.false')
    .not('customer_phone', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  const results: { id: string; status: 'sent' | 'failed'; error?: string }[] = [];

  for (const appt of appointments ?? []) {
    if (!appt.customer_phone) {
      failed++;
      continue;
    }

    const orgName = appt.offices?.organizations?.name ?? 'Qflo';
    const officeName = appt.offices?.name ?? '';
    const dateObj = new Date(appt.scheduled_at);
    const timeStr = dateObj.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const dateStr = dateObj.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
    });

    const body = `📅 *${orgName}*\n\nReminder: ${appt.customer_name}, you have an appointment tomorrow.\n\n📍 ${officeName}\n🕐 ${dateStr} at ${timeStr}\n\nReply CANCEL to cancel.`;

    try {
      const result = await sendWhatsAppMessage({
        to: appt.customer_phone,
        body,
      });

      if (result.ok) {
        sent++;
        await (supabase as any)
          .from('appointments')
          .update({ reminder_sent: true })
          .eq('id', appt.id);
        results.push({ id: appt.id, status: 'sent' });
      } else {
        failed++;
        results.push({ id: appt.id, status: 'failed', error: result.error });
      }
    } catch (err: unknown) {
      failed++;
      const message = err instanceof Error ? err.message : 'Unknown error';
      results.push({ id: appt.id, status: 'failed', error: message });
    }

    // Small throttle between sends
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return NextResponse.json({
    processed: appointments?.length ?? 0,
    sent,
    failed,
    results,
  });
}
