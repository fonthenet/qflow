import 'server-only';

/**
 * Build a customer-facing "your delivery is here, this is what you got"
 * receipt for the closing WhatsApp message. Used by both
 * /api/orders/delivered (operator-side) and /api/rider/delivered
 * (rider-side) so the customer's last touchpoint always carries the
 * itemised breakdown — same as a paper receipt at the door.
 *
 * Format (locale-aware FR / AR / EN):
 *
 *   ✅ Order #FIX-0083 delivered. Enjoy your meal! 🍽️
 *
 *   • 1× Couscous royal — 1 200 DA
 *   • 2× Tajine poulet  — 2 000 DA
 *   • 1× Eau minérale   —    80 DA
 *   ─────────────
 *   Total: 3 280 DA — Paid on delivery
 *
 *   Thanks for choosing Fix.
 *
 * Numbers are right-aligned via U+2003 (em-space) padding so any
 * monospace font in the WA chat lines them up cleanly. Currency comes
 * from organization.settings.currency or falls back to 'DA'.
 */

type Locale = 'ar' | 'fr' | 'en';

function tr(locale: Locale, en: string, fr: string, ar: string) {
  return locale === 'ar' ? ar : locale === 'fr' ? fr : en;
}

interface ItemRow {
  name: string;
  qty: number;
  price: number | null;
}

export async function buildOrderReceiptMessage(
  supabase: any,
  opts: {
    ticketId: string;
    ticketNumber: string;
    orgName: string;
    locale: Locale;
    /** Extra header line above the receipt — e.g. the delivered/ready/dispatched
     *  emoji + sentence. The receipt block follows. */
    headerLine: string;
    /** Track URL appended at the bottom so the customer can re-open the
     *  detailed page if they want it. */
    trackUrl?: string;
  },
): Promise<string> {
  const { ticketId, orgName, locale, headerLine, trackUrl } = opts;

  // Pull items + currency hint in parallel.
  const [{ data: items }, { data: ticketRow }] = await Promise.all([
    supabase
      .from('ticket_items')
      .select('name, qty, price')
      .eq('ticket_id', ticketId)
      .order('added_at', { ascending: true }),
    supabase
      .from('tickets')
      .select('id, office_id')
      .eq('id', ticketId)
      .maybeSingle(),
  ]);

  let currency = 'DA';
  if (ticketRow?.office_id) {
    const { data: office } = await supabase
      .from('offices').select('organization_id').eq('id', ticketRow.office_id).maybeSingle();
    if (office?.organization_id) {
      const { data: org } = await supabase
        .from('organizations').select('settings').eq('id', office.organization_id).maybeSingle();
      const settings = (org?.settings ?? {}) as Record<string, any>;
      if (typeof settings.currency === 'string' && settings.currency.trim()) {
        currency = settings.currency.trim();
      }
    }
  }

  const rows: ItemRow[] = (items ?? []) as ItemRow[];
  if (rows.length === 0) {
    // No itemised order (rare — walk-in pseudo-deliveries or mid-flow data).
    // Just send the header line and a thanks footer.
    const thanks = tr(locale,
      `Thanks for choosing *${orgName}*.`,
      `Merci d'avoir choisi *${orgName}*.`,
      `شكرًا لاختيارك *${orgName}*.`,
    );
    return [headerLine, '', thanks, trackUrl ? `\n${trackUrl}` : ''].filter(Boolean).join('\n');
  }

  // Compute total + format each line as "qty× name — money".
  let total = 0;
  const lines: string[] = [];
  for (const r of rows) {
    const unit = typeof r.price === 'number' && Number.isFinite(r.price) ? r.price : 0;
    const lineTotal = unit * (r.qty ?? 0);
    total += lineTotal;
    const money = `${lineTotal.toFixed(2)} ${currency}`;
    // Quantity FIRST so the line reads naturally: "1× Rechta — 900 DA"
    // matches the cart confirm summary the customer saw earlier in
    // the flow. Old format was "Rechta × 1 — 900 DA" which read awkward
    // ("rechta times one") and didn't match the confirm template.
    lines.push(`• ${r.qty}× ${r.name} — ${money}`);
  }

  const totalLabel = tr(locale, 'Total', 'Total', 'المجموع');
  const paidLabel = tr(locale, 'Paid on delivery', 'Payé à la livraison', 'الدفع عند التسليم');
  const thanks = tr(locale,
    `Thanks for choosing *${orgName}*.`,
    `Merci d'avoir choisi *${orgName}*.`,
    `شكرًا لاختيارك *${orgName}*.`,
  );

  const block = [
    headerLine,
    '',
    ...lines,
    '─────────────',
    `*${totalLabel}: ${total.toFixed(2)} ${currency}* — ${paidLabel}`,
    '',
    thanks,
  ];
  if (trackUrl) {
    block.push('', trackUrl);
  }
  return block.join('\n');
}
