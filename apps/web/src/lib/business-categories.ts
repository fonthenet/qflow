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
  { value: 'healthcare',   emoji: '🏥', label: { en: 'Healthcare',    fr: 'Santé',             ar: 'صحة' } },
  { value: 'banking',      emoji: '🏦', label: { en: 'Banking',       fr: 'Banque',            ar: 'بنوك' } },
  { value: 'government',   emoji: '🏛️', label: { en: 'Government',    fr: 'Gouvernement',      ar: 'حكومة' } },
  { value: 'services',     emoji: '🏢', label: { en: 'Services',      fr: 'Services',          ar: 'خدمات' } },
  { value: 'restaurant',   emoji: '🍽️', label: { en: 'Restaurant',    fr: 'Restaurant',        ar: 'مطعم' } },
  { value: 'education',    emoji: '📚', label: { en: 'Education',     fr: 'Éducation',         ar: 'تعليم' } },
  { value: 'beauty',       emoji: '✂️', label: { en: 'Beauty & Spa',  fr: 'Beauté & Spa',      ar: 'تجميل' } },
  { value: 'telecom',      emoji: '📱', label: { en: 'Telecom',       fr: 'Télécom',           ar: 'اتصالات' } },
  { value: 'insurance',    emoji: '🛡️', label: { en: 'Insurance',     fr: 'Assurance',         ar: 'تأمين' } },
  { value: 'automotive',   emoji: '🚗', label: { en: 'Automotive',    fr: 'Automobile',        ar: 'سيارات' } },
  { value: 'legal',        emoji: '⚖️', label: { en: 'Legal',         fr: 'Juridique',         ar: 'قانوني' } },
  { value: 'real_estate',  emoji: '🏠', label: { en: 'Real Estate',   fr: 'Immobilier',        ar: 'عقارات' } },
  { value: 'other',        emoji: '💼', label: { en: 'Other',         fr: 'Autre',             ar: 'أخرى' } },
];
