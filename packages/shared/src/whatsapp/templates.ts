/**
 * Canonical Qflo WhatsApp template spec — single source of truth.
 *
 * These are the templates Qflo auto-provisions on a tenant's WABA after
 * WhatsApp Embedded Signup. Also used as the reference when sending via
 * the platform-shared number, so behaviour stays identical regardless of
 * which WABA the message goes through.
 *
 * Design rules:
 * - ALL user-facing copy exists in FR/AR/EN (primary markets). Arabic must
 *   be authored by a native speaker before enabling; the strings below are
 *   placeholders marked TODO_AR where a real translation is still needed.
 * - Every template is CATEGORY=utility (queue/appointment/receipt style).
 *   Marketing templates are deliberately out of scope — they trigger
 *   stricter Meta review + per-recipient opt-in tracking we don't do yet.
 * - Variables are numeric ({{1}}, {{2}}, ...). Meta requires explicit
 *   example values per locale at submission time.
 * - Template names are lowercase snake_case, ASCII only, ≤ 512 chars.
 *   Names cannot change once approved — add new templates instead of
 *   renaming existing ones.
 */

export type WhatsAppTemplateLocale = 'fr' | 'ar' | 'en';

export type WhatsAppTemplateCategory = 'UTILITY' | 'AUTHENTICATION' | 'MARKETING';

export interface WhatsAppTemplateLocalization {
  /** Meta language code: en, fr, ar (ISO 639-1). */
  language: string;
  /** Body text with {{1}}, {{2}} placeholders. */
  body: string;
  /** Example values for every {{n}} — required by Meta at submission. */
  example_values: string[];
  /** Optional short footer shown under the body. */
  footer?: string;
}

export interface WhatsAppTemplateSpec {
  name: string;
  category: WhatsAppTemplateCategory;
  /** Ordered list of {{1..n}} descriptors — used by runtime to fill params. */
  variables: Array<{ index: number; role: string }>;
  localizations: Record<WhatsAppTemplateLocale, WhatsAppTemplateLocalization>;
}

// Helper so each template stays readable
const v = (role: string, index: number) => ({ index, role });

export const QFLO_WHATSAPP_TEMPLATES: WhatsAppTemplateSpec[] = [
  {
    name: 'qflo_queue_update',
    category: 'UTILITY',
    variables: [v('business_name', 1), v('body_text', 2)],
    localizations: {
      en: {
        language: 'en',
        body: '*{{1}}*\n\n{{2}}',
        example_values: ['Acme Clinic', 'You are #3 in the queue. Estimated wait: 12 minutes.'],
      },
      fr: {
        language: 'fr',
        body: '*{{1}}*\n\n{{2}}',
        example_values: ['Clinique Acme', 'Vous êtes le n°3 dans la file. Attente estimée : 12 minutes.'],
      },
      ar: {
        language: 'ar',
        body: '*{{1}}*\n\n{{2}}',
        example_values: ['عيادة أكمي', 'أنت رقم 3 في قائمة الانتظار. الوقت المقدر: 12 دقيقة.'],
      },
    },
  },
  {
    name: 'qflo_ticket_confirmation',
    category: 'UTILITY',
    variables: [
      v('business_name', 1),
      v('ticket_code', 2),
      v('service_name', 3),
      v('when', 4),
    ],
    localizations: {
      en: {
        language: 'en',
        body: '*{{1}}*\n\nYour ticket *{{2}}* for {{3}} is confirmed for {{4}}.\nReply *CANCEL* to release your spot.',
        example_values: ['Acme Clinic', 'A-042', 'Consultation', 'today at 14:30'],
      },
      fr: {
        language: 'fr',
        body: '*{{1}}*\n\nVotre ticket *{{2}}* pour {{3}} est confirmé pour {{4}}.\nRépondez *ANNULER* pour libérer votre place.',
        example_values: ['Clinique Acme', 'A-042', 'Consultation', "aujourd'hui à 14:30"],
      },
      ar: {
        language: 'ar',
        body: '*{{1}}*\n\nتم تأكيد تذكرتك *{{2}}* لـ {{3}} في {{4}}.\nأرسل *إلغاء* لإلغاء الحجز.',
        example_values: ['عيادة أكمي', 'A-042', 'استشارة', 'اليوم الساعة 14:30'],
      },
    },
  },
  {
    name: 'qflo_ready_for_service',
    category: 'UTILITY',
    variables: [v('business_name', 1), v('ticket_code', 2), v('desk_or_room', 3)],
    localizations: {
      en: {
        language: 'en',
        body: '*{{1}}*\n\nIt is your turn now — ticket *{{2}}*. Please proceed to *{{3}}*.',
        example_values: ['Acme Clinic', 'A-042', 'Desk 3'],
      },
      fr: {
        language: 'fr',
        body: "*{{1}}*\n\nC'est à vous — ticket *{{2}}*. Merci de vous présenter à *{{3}}*.",
        example_values: ['Clinique Acme', 'A-042', 'Guichet 3'],
      },
      ar: {
        language: 'ar',
        body: '*{{1}}*\n\nحان دورك الآن — التذكرة *{{2}}*. يرجى التوجه إلى *{{3}}*.',
        example_values: ['عيادة أكمي', 'A-042', 'المكتب 3'],
      },
    },
  },
  {
    name: 'qflo_reminder_24h',
    category: 'UTILITY',
    variables: [
      v('business_name', 1),
      v('service_name', 2),
      v('when', 3),
      v('address', 4),
    ],
    localizations: {
      en: {
        language: 'en',
        body: '*{{1}}* — reminder\n\nYour appointment for {{2}} is tomorrow at {{3}}.\nLocation: {{4}}\n\nReply *CANCEL* if you cannot make it.',
        example_values: ['Acme Clinic', 'Consultation', '14:30', '12 Main St, Algiers'],
      },
      fr: {
        language: 'fr',
        body: '*{{1}}* — rappel\n\nVotre rendez-vous pour {{2}} est demain à {{3}}.\nAdresse : {{4}}\n\nRépondez *ANNULER* si vous ne pouvez pas venir.',
        example_values: ['Clinique Acme', 'Consultation', '14:30', '12 rue Principale, Alger'],
      },
      ar: {
        language: 'ar',
        body: '*{{1}}* — تذكير\n\nموعدك لـ {{2}} غدا الساعة {{3}}.\nالعنوان: {{4}}\n\nأرسل *إلغاء* إذا لم تستطع الحضور.',
        example_values: ['عيادة أكمي', 'استشارة', '14:30', '12 شارع الرئيسي، الجزائر'],
      },
    },
  },
  {
    name: 'qflo_cancelled',
    category: 'UTILITY',
    variables: [v('business_name', 1), v('ticket_code', 2)],
    localizations: {
      en: {
        language: 'en',
        body: '*{{1}}*\n\nYour ticket *{{2}}* has been cancelled.',
        example_values: ['Acme Clinic', 'A-042'],
      },
      fr: {
        language: 'fr',
        body: '*{{1}}*\n\nVotre ticket *{{2}}* a été annulé.',
        example_values: ['Clinique Acme', 'A-042'],
      },
      ar: {
        language: 'ar',
        body: '*{{1}}*\n\nتم إلغاء تذكرتك *{{2}}*.',
        example_values: ['عيادة أكمي', 'A-042'],
      },
    },
  },
  {
    name: 'qflo_delay_notice',
    category: 'UTILITY',
    variables: [v('business_name', 1), v('minutes', 2)],
    localizations: {
      en: {
        language: 'en',
        body: '*{{1}}*\n\nSorry — there is a delay of about {{2}} minutes. We will let you know when it is your turn.',
        example_values: ['Acme Clinic', '15'],
      },
      fr: {
        language: 'fr',
        body: '*{{1}}*\n\nDésolé — il y a un retard d\'environ {{2}} minutes. Nous vous préviendrons dès que c\'est à vous.',
        example_values: ['Clinique Acme', '15'],
      },
      ar: {
        language: 'ar',
        body: '*{{1}}*\n\nعذرا — هناك تأخير حوالي {{2}} دقيقة. سنخبرك عندما يحين دورك.',
        example_values: ['عيادة أكمي', '15'],
      },
    },
  },
  {
    name: 'qflo_receipt',
    category: 'UTILITY',
    variables: [
      v('business_name', 1),
      v('ticket_code', 2),
      v('amount', 3),
      v('method', 4),
    ],
    localizations: {
      en: {
        language: 'en',
        body: '*{{1}}* — receipt\n\nTicket *{{2}}*\nAmount: {{3}}\nPaid via: {{4}}\n\nThank you.',
        example_values: ['Acme Clinic', 'A-042', '2000.00 DA', 'Card'],
      },
      fr: {
        language: 'fr',
        body: '*{{1}}* — reçu\n\nTicket *{{2}}*\nMontant : {{3}}\nPayé par : {{4}}\n\nMerci.',
        example_values: ['Clinique Acme', 'A-042', '2000.00 DA', 'Carte'],
      },
      ar: {
        language: 'ar',
        body: '*{{1}}* — إيصال\n\nالتذكرة *{{2}}*\nالمبلغ: {{3}}\nطريقة الدفع: {{4}}\n\nشكرا لك.',
        example_values: ['عيادة أكمي', 'A-042', '2000.00 DA', 'بطاقة'],
      },
    },
  },
];

/**
 * Build the Graph API payload to create a single template in a given locale.
 * POST /{waba_id}/message_templates
 */
export function buildTemplateCreatePayload(
  spec: WhatsAppTemplateSpec,
  locale: WhatsAppTemplateLocale,
): Record<string, unknown> {
  const loc = spec.localizations[locale];
  const components: Array<Record<string, unknown>> = [
    {
      type: 'BODY',
      text: loc.body,
      ...(loc.example_values.length > 0
        ? { example: { body_text: [loc.example_values] } }
        : {}),
    },
  ];
  if (loc.footer) {
    components.push({ type: 'FOOTER', text: loc.footer });
  }
  return {
    name: spec.name,
    category: spec.category,
    language: loc.language,
    components,
  };
}

/** All (template, locale) pairs Qflo provisions on every tenant WABA. */
export function iterateTemplateLocales(): Array<{
  spec: WhatsAppTemplateSpec;
  locale: WhatsAppTemplateLocale;
}> {
  const out: Array<{ spec: WhatsAppTemplateSpec; locale: WhatsAppTemplateLocale }> = [];
  for (const spec of QFLO_WHATSAPP_TEMPLATES) {
    for (const locale of Object.keys(spec.localizations) as WhatsAppTemplateLocale[]) {
      out.push({ spec, locale });
    }
  }
  return out;
}
