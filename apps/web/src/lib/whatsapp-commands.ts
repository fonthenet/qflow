import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { getQueuePosition } from '@/lib/queue-position';
import { createPublicTicket } from '@/lib/actions/public-ticket-actions';

interface OrgContext {
  id: string;
  name: string;
  settings: Record<string, any>;
}

type Locale = 'fr' | 'ar' | 'en';

// ── i18n translations ──────────────────────────────────────────────

const messages: Record<string, Record<Locale, string>> = {
  welcome: {
    fr: [
      '👋 Bienvenue sur *QFlow* !',
      '',
      'Pour rejoindre une file, envoyez :',
      '*REJOINDRE <code>*',
      '',
      'Exemple : *REJOINDRE HADABI*',
      '',
      'Le code se trouve sur l\'affiche QR ou la page d\'inscription.',
    ].join('\n'),
    ar: [
      '👋 مرحبًا بك في *QFlow*!',
      '',
      'للانضمام إلى الطابور، أرسل:',
      '*انضم <الرمز>*',
      '',
      'مثال: *انضم HADABI*',
      '',
      'ستجد الرمز على ملصق QR أو صفحة الانضمام.',
    ].join('\n'),
    en: [
      '👋 Welcome to *QFlow*!',
      '',
      'To join a queue, send:',
      '*JOIN <business code>*',
      '',
      'Example: *JOIN HADABI*',
      '',
      'You\'ll find the code on the business\'s QR poster or join page.',
    ].join('\n'),
  },
  not_in_queue: {
    fr: 'Vous n\'êtes dans aucune file.\n\nPour rejoindre, envoyez *REJOINDRE <code>* (ex: REJOINDRE HADABI).',
    ar: 'أنت لست في أي طابور.\n\nللانضمام، أرسل *انضم <الرمز>* (مثال: انضم HADABI).',
    en: 'You\'re not in any queue.\n\nTo join, send *JOIN <business code>* (e.g. JOIN HADABI).',
  },
  code_not_found: {
    fr: '❌ Code \"*{code}*\" introuvable.\n\nVérifiez le code et réessayez.',
    ar: '❌ الرمز \"*{code}*\" غير موجود.\n\nتحقق من الرمز وحاول مرة أخرى.',
    en: '❌ Business code \"*{code}*\" not found.\n\nPlease check the code and try again.',
  },
  already_in_queue: {
    fr: 'Vous êtes déjà dans la file chez *{name}*.\n{position}\n\nRépondez *STATUT* pour les mises à jour ou *ANNULER* pour quitter.',
    ar: 'أنت بالفعل في الطابور في *{name}*.\n{position}\n\nأرسل *حالة* للتحديثات أو *إلغاء* للمغادرة.',
    en: 'You\'re already in the queue at *{name}*.\n{position}\n\nReply *STATUS* for updates or *CANCEL* to leave.',
  },
  queue_not_configured: {
    fr: 'Désolé, la file WhatsApp n\'est pas encore configurée pour *{name}*. Veuillez rejoindre via le QR code.',
    ar: 'عذرًا، طابور واتساب غير مُهيّأ بعد لـ *{name}*. يرجى الانضمام عبر رمز QR.',
    en: 'Sorry, WhatsApp queue is not fully configured for *{name}* yet. Please join via the QR code instead.',
  },
  queue_closed: {
    fr: 'Désolé, cette file est actuellement fermée. Réessayez plus tard.',
    ar: 'عذرًا، هذا الطابور مغلق حاليًا. حاول مرة أخرى لاحقًا.',
    en: 'Sorry, this queue is currently closed. Please try again later.',
  },
  queue_requires_service: {
    fr: 'Désolé, cette file nécessite de choisir un service. Rejoignez via le lien QR code.',
    ar: 'عذرًا، يتطلب هذا الطابور اختيار خدمة. انضم عبر رابط QR.',
    en: 'Sorry, this queue requires choosing a service. Please join via the QR code link instead.',
  },
  join_error: {
    fr: '⚠️ Impossible de rejoindre la file : {error}',
    ar: '⚠️ تعذر الانضمام إلى الطابور: {error}',
    en: '⚠️ Could not join the queue: {error}',
  },
  join_failed: {
    fr: '⚠️ Une erreur est survenue. Veuillez réessayer.',
    ar: '⚠️ حدث خطأ. يرجى المحاولة مرة أخرى.',
    en: '⚠️ Something went wrong. Please try again.',
  },
  joined: {
    fr: '✅ Vous êtes dans la file chez *{name}* !\n\n🎫 Ticket : *{ticket}*\n{position}{now_serving}\n\n📍 Suivez votre position : {url}\n\nRépondez *STATUT* pour les mises à jour ou *ANNULER* pour quitter.',
    ar: '✅ أنت في الطابور في *{name}*!\n\n🎫 التذكرة: *{ticket}*\n{position}{now_serving}\n\n📍 تتبع موقعك: {url}\n\nأرسل *حالة* للتحديثات أو *إلغاء* للمغادرة.',
    en: '✅ You\'re in the queue at *{name}*!\n\n🎫 Ticket: *{ticket}*\n{position}{now_serving}\n\n📍 Track your position: {url}\n\nReply *STATUS* for updates or *CANCEL* to leave.',
  },
  your_turn: {
    fr: '🔔 *C\'est votre tour !* Veuillez vous diriger vers le point de service.',
    ar: '🔔 *حان دورك!* يرجى التوجه إلى نقطة الخدمة.',
    en: '🔔 *It\'s your turn!* Please proceed to your service point.',
  },
  ticket_inactive: {
    fr: 'Votre ticket n\'est plus actif. Envoyez *REJOINDRE <code>* pour rejoindre à nouveau.',
    ar: 'تذكرتك لم تعد نشطة. أرسل *انضم <الرمز>* للانضمام مجددًا.',
    en: 'Your ticket is no longer active. Send *JOIN <code>* to join again.',
  },
  status: {
    fr: '📊 *État de la file — {name}*\n\n📍 Votre position : *{position}*\n⏱ Attente estimée : *{wait} min*\n{now_serving}👥 En attente : *{total}*\n\nRépondez *ANNULER* pour quitter la file.',
    ar: '📊 *حالة الطابور — {name}*\n\n📍 موقعك: *{position}*\n⏱ الانتظار المقدر: *{wait} دقيقة*\n{now_serving}👥 في الانتظار: *{total}*\n\nأرسل *إلغاء* للمغادرة.',
    en: '📊 *Queue Status — {name}*\n\n📍 Your position: *{position}*\n⏱ Estimated wait: *{wait} min*\n{now_serving}👥 Total waiting: *{total}*\n\nReply *CANCEL* to leave the queue.',
  },
  cancelled: {
    fr: '✅ Votre ticket a été annulé. Envoyez *REJOINDRE <code>* pour rejoindre à tout moment.',
    ar: '✅ تم إلغاء تذكرتك. أرسل *انضم <الرمز>* للانضمام في أي وقت.',
    en: '✅ Your ticket has been cancelled. Send *JOIN <code>* to rejoin anytime.',
  },
  help_with_session: {
    fr: '📋 *{name}* — File\n\nCommandes :\n• *STATUT* — Vérifier votre position\n• *ANNULER* — Quitter la file',
    ar: '📋 *{name}* — الطابور\n\nالأوامر:\n• *حالة* — التحقق من موقعك\n• *إلغاء* — مغادرة الطابور',
    en: '📋 *{name}* — Queue\n\nCommands:\n• *STATUS* — Check your position\n• *CANCEL* — Leave the queue',
  },
  not_in_queue_rejoin: {
    fr: 'Vous n\'êtes dans aucune file. Envoyez *REJOINDRE <code>* pour rejoindre.',
    ar: 'أنت لست في أي طابور. أرسل *انضم <الرمز>* للانضمام.',
    en: 'You\'re not in any queue. Send *JOIN <code>* to join.',
  },
};

// ── Notification messages (called from /api/whatsapp-send) ─────────

export const notificationMessages: Record<string, Record<Locale, string>> = {
  called: {
    fr: '🔔 *C\'est votre tour !* Ticket *{ticket}* — veuillez vous rendre au *{desk}*.\n\nSuivi : {url}',
    ar: '🔔 *حان دورك!* التذكرة *{ticket}* — يرجى التوجه إلى *{desk}*.\n\nتتبع: {url}',
    en: '🔔 *It\'s your turn!* Ticket *{ticket}* — please go to *{desk}*.\n\nTrack: {url}',
  },
  recall: {
    fr: '⏰ *Rappel :* Le ticket *{ticket}* vous attend toujours au *{desk}*.\n\nSuivi : {url}',
    ar: '⏰ *تذكير:* التذكرة *{ticket}* لا تزال بانتظارك في *{desk}*.\n\nتتبع: {url}',
    en: '⏰ *Reminder:* Ticket *{ticket}* is still waiting for you at *{desk}*.\n\nTrack: {url}',
  },
  buzz: {
    fr: '📢 *Appel :* Le personnel essaie de vous joindre (ticket *{ticket}*). Rendez-vous au *{desk}*.\n\nSuivi : {url}',
    ar: '📢 *تنبيه:* يحاول الموظفون الوصول إليك (التذكرة *{ticket}*). توجه إلى *{desk}*.\n\nتتبع: {url}',
    en: '📢 *Buzz:* Staff is trying to reach you (ticket *{ticket}*). Please go to *{desk}*.\n\nTrack: {url}',
  },
  no_show: {
    fr: '❌ Le ticket *{ticket}* a été marqué *absent*. Vous avez manqué votre tour.\n\nEnvoyez *REJOINDRE <code>* pour rejoindre à nouveau.',
    ar: '❌ التذكرة *{ticket}* تم تسجيلها كـ *غائب*. لقد فاتك دورك.\n\nأرسل *انضم <الرمز>* للانضمام مجددًا.',
    en: '❌ Ticket *{ticket}* was marked as *no show*. You missed your turn.\n\nSend *JOIN <code>* to rejoin.',
  },
  served: {
    fr: '✅ Le ticket *{ticket}* est terminé. Merci pour votre visite !\n\nNous espérons vous revoir bientôt.',
    ar: '✅ التذكرة *{ticket}* مكتملة. شكرًا لزيارتكم!\n\nنتمنى رؤيتكم مجددًا.',
    en: '✅ Ticket *{ticket}* is complete. Thank you for visiting!\n\nWe hope to see you again.',
  },
  cancelled_notify: {
    fr: '🚫 Le ticket *{ticket}* a été annulé.',
    ar: '🚫 تم إلغاء التذكرة *{ticket}*.',
    en: '🚫 Ticket *{ticket}* has been cancelled.',
  },
  default: {
    fr: '📋 Mise à jour du ticket *{ticket}* : {url}',
    ar: '📋 تحديث التذكرة *{ticket}*: {url}',
    en: '📋 Update for ticket *{ticket}*: {url}',
  },
};

// ── Locale detection ───────────────────────────────────────────────

function detectLocale(message: string): Locale {
  const trimmed = message.trim();
  const upper = trimmed.toUpperCase();

  // French keywords
  if (/^(REJOINDRE|STATUT|ANNULER)\b/i.test(trimmed)) return 'fr';

  // Arabic keywords
  if (/^(انضم|حالة|إلغاء|الغاء)\b/.test(trimmed)) return 'ar';

  // English keywords
  if (/^(JOIN|STATUS|CANCEL)\b/i.test(trimmed)) return 'en';

  // Check for Arabic characters anywhere
  if (/[\u0600-\u06FF]/.test(trimmed)) return 'ar';

  // Default to French for Algeria
  return 'fr';
}

function t(key: string, locale: Locale, vars?: Record<string, string | number | null | undefined>): string {
  let msg = messages[key]?.[locale] ?? messages[key]?.['fr'] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? '?'));
    }
  }
  return msg;
}

export function tNotification(key: string, locale: Locale, vars?: Record<string, string | number | null | undefined>): string {
  let msg = notificationMessages[key]?.[locale] ?? notificationMessages[key]?.['fr'] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? '?'));
    }
  }
  return msg;
}

// ── Shared-number routing ──────────────────────────────────────────

function parseBusinessCode(message: string): { code: string; locale: Locale } | null {
  const trimmed = message.trim();
  // French: REJOINDRE HADABI
  const frMatch = trimmed.match(/^REJOINDRE[\s\-]+(.+)$/i);
  if (frMatch) return { code: frMatch[1].trim().toUpperCase(), locale: 'fr' };
  // Arabic: انضم HADABI
  const arMatch = trimmed.match(/^(?:انضم|إنضم)[\s\-]+(.+)$/);
  if (arMatch) return { code: arMatch[1].trim().toUpperCase(), locale: 'ar' };
  // English: JOIN HADABI
  const enMatch = trimmed.match(/^JOIN[\s\-]+(.+)$/i);
  if (enMatch) return { code: enMatch[1].trim().toUpperCase(), locale: 'en' };
  return null;
}

async function findOrgByCode(code: string): Promise<OrgContext | null> {
  const supabase = createAdminClient();
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, settings');

  const org = (orgs ?? []).find((o: any) => {
    const settings = (o.settings ?? {}) as Record<string, any>;
    if (!settings.whatsapp_enabled) return false;
    const orgCode = (settings.whatsapp_code ?? '').toString().toUpperCase().trim();
    return orgCode === code;
  });

  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    settings: (org.settings ?? {}) as Record<string, any>,
  };
}

async function findOrgByActiveSession(phone: string): Promise<{ org: OrgContext; session: any } | null> {
  const supabase = createAdminClient() as any;
  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('id, ticket_id, organization_id, locale')
    .eq('whatsapp_phone', phone)
    .eq('state', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) return null;

  const adminClient = createAdminClient();
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('id, name, settings')
    .eq('id', session.organization_id)
    .single();

  if (!orgRow) return null;

  return {
    org: {
      id: orgRow.id,
      name: orgRow.name,
      settings: (orgRow.settings ?? {}) as Record<string, any>,
    },
    session,
  };
}

function formatPosition(pos: any, locale: Locale): string {
  if (pos.position == null) return '';
  return `📍 Position: *${pos.position}* | ⏱ ~*${pos.estimated_wait_minutes ?? '?'} min*`;
}

// ── Main entry point ───────────────────────────────────────────────

export async function handleWhatsAppMessage(
  phone: string,
  messageBody: string
): Promise<void> {
  const command = messageBody.trim().toUpperCase();
  const detectedLocale = detectLocale(messageBody);

  // ── STATUS / STATUT / حالة ──
  if (command === 'STATUS' || command === 'STATUT' || messageBody.trim() === 'حالة') {
    const found = await findOrgByActiveSession(phone);
    if (found) {
      const sessionLocale = (found.session.locale as Locale) || detectedLocale;
      await handleStatus(phone, found.org, sessionLocale);
    } else {
      await sendWhatsAppMessage({
        to: phone,
        body: t('not_in_queue', detectedLocale),
      });
    }
    return;
  }

  // ── CANCEL / ANNULER / إلغاء ──
  if (command === 'CANCEL' || command === 'ANNULER' || messageBody.trim() === 'إلغاء' || messageBody.trim() === 'الغاء') {
    const found = await findOrgByActiveSession(phone);
    if (found) {
      const sessionLocale = (found.session.locale as Locale) || detectedLocale;
      await handleCancel(phone, found.org, sessionLocale);
    } else {
      await sendWhatsAppMessage({
        to: phone,
        body: t('not_in_queue', detectedLocale),
      });
    }
    return;
  }

  // ── JOIN with code — "JOIN HADABI" / "REJOINDRE HADABI" / "انضم HADABI" ──
  const parsed = parseBusinessCode(messageBody);
  if (parsed) {
    const org = await findOrgByCode(parsed.code);
    if (org) {
      await handleJoin(phone, org, parsed.locale);
    } else {
      await sendWhatsAppMessage({
        to: phone,
        body: t('code_not_found', parsed.locale, { code: parsed.code }),
      });
    }
    return;
  }

  // ── Plain "JOIN" / "REJOINDRE" / "انضم" without code ──
  if (command === 'JOIN' || command === 'REJOINDRE' || messageBody.trim() === 'انضم' || messageBody.trim() === 'إنضم') {
    const found = await findOrgByActiveSession(phone);
    if (found) {
      const sessionLocale = (found.session.locale as Locale) || detectedLocale;
      const pos = await getQueuePosition(found.session.ticket_id);
      await sendWhatsAppMessage({
        to: phone,
        body: t('already_in_queue', sessionLocale, {
          name: found.org.name,
          position: formatPosition(pos, sessionLocale),
        }),
      });
    } else {
      await sendWhatsAppMessage({
        to: phone,
        body: t('welcome', detectedLocale),
      });
    }
    return;
  }

  // ── Maybe the message IS the code (e.g. just "HADABI") ──
  const maybeCode = messageBody.trim().toUpperCase();
  if (maybeCode.length >= 2 && maybeCode.length <= 30 && /^[A-Z0-9_-]+$/.test(maybeCode)) {
    const org = await findOrgByCode(maybeCode);
    if (org) {
      await handleJoin(phone, org, detectedLocale);
      return;
    }
  }

  // ── Unknown message — check for active session or show help ──
  const found = await findOrgByActiveSession(phone);
  if (found) {
    const sessionLocale = (found.session.locale as Locale) || detectedLocale;
    await sendWhatsAppMessage({
      to: phone,
      body: t('help_with_session', sessionLocale, { name: found.org.name }),
    });
  } else {
    await sendWhatsAppMessage({
      to: phone,
      body: t('welcome', detectedLocale),
    });
  }
}

// ── JOIN ────────────────────────────────────────────────────────────

async function handleJoin(phone: string, org: OrgContext, locale: Locale): Promise<void> {
  const supabase = createAdminClient() as any;

  // Check for an existing active session at this org
  const { data: existing } = await supabase
    .from('whatsapp_sessions')
    .select('id, ticket_id')
    .eq('whatsapp_phone', phone)
    .eq('organization_id', org.id)
    .eq('state', 'active')
    .maybeSingle();

  if (existing?.ticket_id) {
    const pos = await getQueuePosition(existing.ticket_id);
    await sendWhatsAppMessage({
      to: phone,
      body: t('already_in_queue', locale, {
        name: org.name,
        position: formatPosition(pos, locale),
      }),
    });
    return;
  }

  const virtualCodeId = org.settings?.whatsapp_default_virtual_code_id;
  if (!virtualCodeId) {
    await sendWhatsAppMessage({
      to: phone,
      body: t('queue_not_configured', locale, { name: org.name }),
    });
    return;
  }

  const { data: vCode } = await supabase
    .from('virtual_queue_codes')
    .select('*')
    .eq('id', virtualCodeId)
    .single();

  if (!vCode || !vCode.is_active) {
    await sendWhatsAppMessage({
      to: phone,
      body: t('queue_closed', locale),
    });
    return;
  }

  const officeId = vCode.office_id;
  const departmentId = vCode.department_id;
  const serviceId = vCode.service_id;

  if (!officeId || !departmentId || !serviceId) {
    await sendWhatsAppMessage({
      to: phone,
      body: t('queue_requires_service', locale),
    });
    return;
  }

  const result = await createPublicTicket({
    officeId,
    departmentId,
    serviceId,
    customerData: { phone, source: 'whatsapp' },
    isRemote: true,
    source: 'whatsapp',
  });

  if ('error' in result && result.error) {
    await sendWhatsAppMessage({
      to: phone,
      body: t('join_error', locale, { error: result.error }),
    });
    return;
  }

  const ticket = result.data;
  if (!ticket) {
    await sendWhatsAppMessage({
      to: phone,
      body: t('join_failed', locale),
    });
    return;
  }

  // Create WhatsApp session with locale
  const { error: sessionError } = await supabase.from('whatsapp_sessions').insert({
    organization_id: org.id,
    whatsapp_phone: phone,
    ticket_id: ticket.id,
    virtual_queue_code_id: virtualCodeId,
    office_id: officeId,
    department_id: departmentId,
    service_id: serviceId,
    state: 'active',
    locale,
  });
  if (sessionError) {
    console.error('[WhatsApp:join] Session insert error:', JSON.stringify(sessionError));
  }

  const pos = await getQueuePosition(ticket.id);

  // Build tracking URL
  const baseUrl = (
    process.env.APP_CLIP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://qflo.net'
  ).replace(/\/+$/, '');
  const trackUrl = `${baseUrl}/q/${ticket.qr_token}`;

  await sendWhatsAppMessage({
    to: phone,
    body: t('joined', locale, {
      name: org.name,
      ticket: ticket.ticket_number,
      position: pos.position != null
        ? `📍 Position: *${pos.position}* | ⏱ ~*${pos.estimated_wait_minutes ?? '?'} min*`
        : '',
      now_serving: pos.now_serving ? `📢 Now serving: *${pos.now_serving}*\n` : '',
      url: trackUrl,
    }),
  });
}

// ── STATUS ──────────────────────────────────────────────────────────

async function handleStatus(phone: string, org: OrgContext, locale: Locale): Promise<void> {
  const supabase = createAdminClient() as any;

  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('ticket_id')
    .eq('whatsapp_phone', phone)
    .eq('organization_id', org.id)
    .eq('state', 'active')
    .maybeSingle();

  if (!session?.ticket_id) {
    await sendWhatsAppMessage({
      to: phone,
      body: t('not_in_queue_rejoin', locale),
    });
    return;
  }

  const pos = await getQueuePosition(session.ticket_id);

  if (pos.position === 0) {
    await sendWhatsAppMessage({
      to: phone,
      body: t('your_turn', locale),
    });
    return;
  }

  if (pos.position === null) {
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'completed' })
      .eq('whatsapp_phone', phone)
      .eq('organization_id', org.id)
      .eq('state', 'active');

    await sendWhatsAppMessage({
      to: phone,
      body: t('ticket_inactive', locale),
    });
    return;
  }

  await sendWhatsAppMessage({
    to: phone,
    body: t('status', locale, {
      name: org.name,
      position: pos.position,
      wait: pos.estimated_wait_minutes ?? '?',
      now_serving: pos.now_serving ? `📢 Now serving: *${pos.now_serving}*\n` : '',
      total: pos.total_waiting,
    }),
  });
}

// ── CANCEL ──────────────────────────────────────────────────────────

async function handleCancel(phone: string, org: OrgContext, locale: Locale): Promise<void> {
  const supabase = createAdminClient() as any;

  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('id, ticket_id')
    .eq('whatsapp_phone', phone)
    .eq('organization_id', org.id)
    .eq('state', 'active')
    .maybeSingle();

  if (!session?.ticket_id) {
    await sendWhatsAppMessage({
      to: phone,
      body: t('not_in_queue_rejoin', locale),
    });
    return;
  }

  const { error: cancelError } = await supabase
    .from('tickets')
    .update({ status: 'cancelled' })
    .eq('id', session.ticket_id)
    .in('status', ['waiting', 'issued', 'called']);

  if (cancelError) {
    console.error('[WhatsApp:cancel] Failed to cancel ticket:', cancelError);
  }

  await supabase.from('ticket_events').insert({
    ticket_id: session.ticket_id,
    event_type: 'cancelled',
    to_status: 'cancelled',
    metadata: { source: 'whatsapp_cancel' },
  });

  await supabase
    .from('whatsapp_sessions')
    .update({ state: 'completed' })
    .eq('id', session.id);

  await sendWhatsAppMessage({
    to: phone,
    body: t('cancelled', locale),
  });
}
