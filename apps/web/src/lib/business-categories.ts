/**
 * Business categories for the public directory.
 * Used in WhatsApp/Messenger LIST command, admin settings, and registration.
 */

export type BusinessCategory =
  | 'healthcare'
  | 'banking'
  | 'government'
  | 'services'
  | 'restaurant'
  | 'education'
  | 'beauty'
  | 'telecom'
  | 'insurance'
  | 'automotive'
  | 'legal'
  | 'real_estate'
  | 'other';

export interface CategoryDefinition {
  value: BusinessCategory;
  emoji: string;
  label: { en: string; fr: string; ar: string };
}

export const BUSINESS_CATEGORIES: CategoryDefinition[] = [
  { value: 'healthcare',   emoji: '🏥', label: { en: 'Healthcare',        fr: 'Santé',              ar: 'الصحة' } },
  { value: 'banking',      emoji: '🏦', label: { en: 'Banking & Finance', fr: 'Banque & Finance',   ar: 'البنوك والمالية' } },
  { value: 'government',   emoji: '🏛️', label: { en: 'Government',        fr: 'Gouvernement',       ar: 'الإدارات الحكومية' } },
  { value: 'services',     emoji: '🏢', label: { en: 'Public Services',   fr: 'Services Publics',   ar: 'الخدمات العمومية' } },
  { value: 'restaurant',   emoji: '🍽️', label: { en: 'Restaurants',       fr: 'Restaurants',        ar: 'المطاعم' } },
  { value: 'education',    emoji: '📚', label: { en: 'Education',         fr: 'Éducation',          ar: 'التعليم' } },
  { value: 'beauty',       emoji: '✂️', label: { en: 'Beauty & Spa',      fr: 'Beauté & Spa',       ar: 'التجميل والعناية' } },
  { value: 'telecom',      emoji: '📱', label: { en: 'Telecom',           fr: 'Télécom',            ar: 'الاتصالات' } },
  { value: 'insurance',    emoji: '🛡️', label: { en: 'Insurance',         fr: 'Assurance',          ar: 'التأمين' } },
  { value: 'automotive',   emoji: '🚗', label: { en: 'Automotive',        fr: 'Automobile',         ar: 'السيارات' } },
  { value: 'legal',        emoji: '⚖️', label: { en: 'Legal',             fr: 'Juridique',          ar: 'الشؤون القانونية' } },
  { value: 'real_estate',  emoji: '🏠', label: { en: 'Real Estate',       fr: 'Immobilier',         ar: 'العقارات' } },
  { value: 'other',        emoji: '💼', label: { en: 'Other',             fr: 'Autre',              ar: 'أخرى' } },
];
