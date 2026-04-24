/**
 * Setup wizard spec — the data contract shared between the Portal and Station
 * signup flows.
 *
 * Both the web /admin/setup-wizard (post-register "finish setup" flow) and
 * the Station Signup screen render from this spec. The API endpoint
 * /api/onboarding/create-business consumes a payload shaped like
 * `SetupWizardSubmission` and seeds a ready-to-use business.
 *
 * To reconfigure the wizard (add a field, change a label, reorder steps),
 * edit this file and both UIs pick up the change.
 */

import type { BusinessCategory, LocalizedText } from './categories';

export type SetupWizardMode = 'new-signup' | 'post-register';

export type SetupWizardStepId = 'business' | 'location' | 'ready';

export type SetupWizardFieldKind =
  | 'text'
  | 'email'
  | 'password'
  | 'category'
  | 'timezone'
  | 'address';

export interface SetupWizardField {
  name: string;
  kind: SetupWizardFieldKind;
  label: LocalizedText;
  placeholder?: LocalizedText;
  /** If false, the field is collected already (e.g. on /register); hide it in `post-register` mode. */
  showIn: ReadonlyArray<SetupWizardMode>;
  required: boolean;
  /** Optional min length for text/password fields. */
  minLength?: number;
}

export interface SetupWizardStep {
  id: SetupWizardStepId;
  /** Title shown at the top of the card. */
  title: LocalizedText;
  /** One-line helper shown under the title. */
  subtitle: LocalizedText;
  fields: ReadonlyArray<SetupWizardField>;
  /** Label for the primary button on this step. */
  cta: LocalizedText;
}

export interface SetupWizardSpec {
  steps: ReadonlyArray<SetupWizardStep>;
}

// ── Default spec ────────────────────────────────────────────────────────────
// Edit this to change what the wizard asks. Both Portal + Station use it.

export const DEFAULT_SETUP_WIZARD_SPEC: SetupWizardSpec = {
  steps: [
    {
      id: 'business',
      title: {
        en: 'About your business',
        fr: 'À propos de votre entreprise',
        ar: 'عن نشاطك التجاري',
      },
      subtitle: {
        en: "We'll use this to tailor the queue experience for your customers.",
        fr: "Nous l'utiliserons pour adapter la file d'attente à vos clients.",
        ar: 'سنستخدم هذه المعلومات لتخصيص تجربة طابور الانتظار لعملائك.',
      },
      fields: [
        {
          name: 'businessName',
          kind: 'text',
          label: { en: 'Business name', fr: "Nom de l'entreprise", ar: 'اسم النشاط' },
          placeholder: {
            en: 'City Hospital, Downtown Bank…',
            fr: 'Clinique Saphir, Banque du Centre…',
            ar: 'مستشفى المدينة، بنك الوسط…',
          },
          showIn: ['new-signup', 'post-register'],
          required: true,
          minLength: 2,
        },
        {
          name: 'category',
          kind: 'category',
          label: { en: 'Category', fr: 'Catégorie', ar: 'الفئة' },
          showIn: ['new-signup', 'post-register'],
          required: true,
        },
        {
          name: 'fullName',
          kind: 'text',
          label: { en: 'Your full name', fr: 'Votre nom complet', ar: 'اسمك الكامل' },
          placeholder: { en: 'Amine Benali', fr: 'Amine Benali', ar: 'أمين بن علي' },
          showIn: ['new-signup'],
          required: true,
          minLength: 2,
        },
        {
          name: 'email',
          kind: 'email',
          label: { en: 'Email', fr: 'E-mail', ar: 'البريد الإلكتروني' },
          placeholder: { en: 'you@company.com', fr: 'vous@entreprise.com', ar: 'you@company.com' },
          showIn: ['new-signup'],
          required: true,
        },
        {
          name: 'password',
          kind: 'password',
          label: { en: 'Password', fr: 'Mot de passe', ar: 'كلمة المرور' },
          placeholder: { en: 'Minimum 6 characters', fr: 'Minimum 6 caractères', ar: '6 أحرف على الأقل' },
          showIn: ['new-signup'],
          required: true,
          minLength: 6,
        },
      ],
      cta: { en: 'Continue', fr: 'Continuer', ar: 'متابعة' },
    },
    {
      id: 'location',
      title: {
        en: 'Your first location',
        fr: 'Votre premier emplacement',
        ar: 'موقعك الأول',
      },
      subtitle: {
        en: "We'll create one office ready to accept customers — you can add more later.",
        fr: "Nous créerons un bureau prêt à accueillir des clients — vous pourrez en ajouter d'autres.",
        ar: 'سننشئ فرعاً واحداً جاهزاً لاستقبال الزبائن — يمكنك إضافة المزيد لاحقاً.',
      },
      fields: [
        {
          name: 'officeName',
          kind: 'text',
          label: { en: 'Office name', fr: 'Nom du bureau', ar: 'اسم الفرع' },
          placeholder: {
            en: 'Main Branch, Downtown Clinic…',
            fr: 'Agence Principale, Clinique Centre…',
            ar: 'الفرع الرئيسي، عيادة الوسط…',
          },
          showIn: ['new-signup', 'post-register'],
          required: true,
          minLength: 2,
        },
        {
          name: 'address',
          kind: 'address',
          label: { en: 'Address (optional)', fr: 'Adresse (facultatif)', ar: 'العنوان (اختياري)' },
          placeholder: {
            en: '12 Main Street, City',
            fr: '12 rue Didouche, Alger',
            ar: '12 شارع ديدوش، الجزائر',
          },
          showIn: ['new-signup', 'post-register'],
          required: false,
        },
        {
          name: 'timezone',
          kind: 'timezone',
          label: { en: 'Timezone', fr: 'Fuseau horaire', ar: 'المنطقة الزمنية' },
          showIn: ['new-signup', 'post-register'],
          required: true,
        },
      ],
      cta: { en: 'Create my business', fr: 'Créer mon entreprise', ar: 'إنشاء نشاطي' },
    },
    {
      id: 'ready',
      title: { en: "You're ready", fr: 'Tout est prêt', ar: 'كل شيء جاهز' },
      subtitle: {
        en: "We've set up a starter department, service, and counter. You can start accepting customers right now.",
        fr: 'Nous avons créé un département, un service et un guichet de démarrage. Vous pouvez accueillir des clients dès maintenant.',
        ar: 'أنشأنا قسماً وخدمة وشباكاً للبدء. يمكنك استقبال الزبائن الآن.',
      },
      fields: [],
      cta: { en: 'Open my dashboard', fr: 'Ouvrir mon tableau de bord', ar: 'فتح لوحة التحكم' },
    },
  ],
};

// ── Submission shape ────────────────────────────────────────────────────────

export interface SetupWizardSubmission {
  // Step 1 (new-signup collects all of these; post-register reads from the session)
  businessName: string;
  category: BusinessCategory;
  fullName?: string;
  email?: string;
  password?: string;
  // Step 2 — location
  officeName: string;
  address?: string;
  /** ISO-2 country code (e.g. "DZ"). Used to derive the dial code and verticals-country overlay. */
  country?: string;
  /** Selected city name (as shown to the user) — free-form fallback allowed. */
  city?: string;
  /** Derived automatically from (country, city). Kept in the payload so the server can persist it. */
  timezone: string;
}

/**
 * Fallback timezone when the browser can't resolve one.
 */
export const DEFAULT_TIMEZONE = 'Africa/Algiers';

/**
 * Default operating hours the wizard stamps onto the first office.
 * Mon–Sat 9:00–18:00, closed Sunday. Operators can edit from Offices.
 */
export const DEFAULT_OFFICE_HOURS = {
  monday:    { open: '09:00', close: '18:00', closed: false },
  tuesday:   { open: '09:00', close: '18:00', closed: false },
  wednesday: { open: '09:00', close: '18:00', closed: false },
  thursday:  { open: '09:00', close: '18:00', closed: false },
  friday:    { open: '09:00', close: '18:00', closed: false },
  saturday:  { open: '09:00', close: '18:00', closed: false },
  sunday:    { open: '09:00', close: '18:00', closed: true },
} as const;

/**
 * Helpful default for the timezone input — used as the initial value.
 */
export function detectDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
