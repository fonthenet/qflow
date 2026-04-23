-- Migration: add_country_vertical_to_orgs
-- Adds country_config and verticals global tables, then adds country + vertical
-- columns to organizations with backfill and RLS.

-- ============================================================
-- 1. TABLE: public.country_config
-- ============================================================
CREATE TABLE IF NOT EXISTS public.country_config (
  code                text PRIMARY KEY,                                    -- ISO-3166-1 alpha-2
  name_en             text NOT NULL,
  name_fr             text NOT NULL,
  name_ar             text NOT NULL,
  currency_code       text NOT NULL,                                       -- ISO-4217
  currency_symbol     text NOT NULL,
  currency_decimals   int  NOT NULL DEFAULT 2,
  locale_default      text NOT NULL,                                       -- BCP-47
  locale_fallbacks    text[] NOT NULL DEFAULT '{}',
  timezone_default    text NOT NULL,                                       -- IANA
  phone_country_code  text NOT NULL,
  region              text NOT NULL CHECK (region IN ('africa','mena','europe','americas','asia','oceania')),
  vat_rate_default    numeric(5,2),
  vat_label           text,
  payment_providers   text[] NOT NULL DEFAULT '{}',
  channel_providers   text[] NOT NULL DEFAULT ARRAY['whatsapp','messenger'],
  feature_flags       jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- RLS on country_config
ALTER TABLE public.country_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "country_config_select_authenticated" ON public.country_config;
CREATE POLICY "country_config_select_authenticated"
  ON public.country_config
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 2. SEED: country_config (13 countries)
-- ============================================================
INSERT INTO public.country_config (
  code, name_en, name_fr, name_ar,
  currency_code, currency_symbol, currency_decimals,
  locale_default, locale_fallbacks,
  timezone_default, phone_country_code, region,
  vat_rate_default, vat_label,
  payment_providers, channel_providers, feature_flags
) VALUES
  (
    'DZ', 'Algeria', 'Algérie', 'الجزائر',
    'DZD', 'DA', 2,
    'fr-DZ', ARRAY['ar-DZ','en'],
    'Africa/Algiers', '+213', 'africa',
    19.00, 'TVA',
    ARRAY['cib','edahabia','satim','stripe'],
    ARRAY['whatsapp','messenger'],
    '{"wilaya_picker": true, "dzd_centimes": true}'::jsonb
  ),
  (
    'MA', 'Morocco', 'Maroc', 'المغرب',
    'MAD', 'DH', 2,
    'fr-MA', ARRAY['ar-MA','en'],
    'Africa/Casablanca', '+212', 'africa',
    20.00, 'TVA',
    ARRAY['cmi','stripe'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'TN', 'Tunisia', 'Tunisie', 'تونس',
    'TND', 'DT', 3,
    'fr-TN', ARRAY['ar-TN','en'],
    'Africa/Tunis', '+216', 'africa',
    19.00, 'TVA',
    ARRAY['paymee','stripe'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'EG', 'Egypt', 'Égypte', 'مصر',
    'EGP', 'E£', 2,
    'ar-EG', ARRAY['en'],
    'Africa/Cairo', '+20', 'mena',
    14.00, 'VAT',
    ARRAY['fawry','stripe'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'FR', 'France', 'France', 'فرنسا',
    'EUR', '€', 2,
    'fr-FR', ARRAY['en'],
    'Europe/Paris', '+33', 'europe',
    20.00, 'TVA',
    ARRAY['stripe','paypal'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'US', 'United States', 'États-Unis', 'الولايات المتحدة',
    'USD', '$', 2,
    'en-US', ARRAY['fr','ar'],
    'America/New_York', '+1', 'americas',
    NULL, 'TAX',
    ARRAY['stripe','paypal','square'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'AE', 'United Arab Emirates', 'Émirats arabes unis', 'الإمارات العربية المتحدة',
    'AED', 'AED', 2,
    'ar-AE', ARRAY['en'],
    'Asia/Dubai', '+971', 'mena',
    5.00, 'VAT',
    ARRAY['stripe','tap'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'SA', 'Saudi Arabia', 'Arabie saoudite', 'المملكة العربية السعودية',
    'SAR', 'SR', 2,
    'ar-SA', ARRAY['en'],
    'Asia/Riyadh', '+966', 'mena',
    15.00, 'VAT',
    ARRAY['stripe','mada','stcpay'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'IN', 'India', 'Inde', 'الهند',
    'INR', '₹', 2,
    'en-IN', ARRAY['hi','fr'],
    'Asia/Kolkata', '+91', 'asia',
    18.00, 'GST',
    ARRAY['razorpay','stripe','paytm'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'SN', 'Senegal', 'Sénégal', 'السنغال',
    'XOF', 'CFA', 0,
    'fr-SN', ARRAY['en'],
    'Africa/Dakar', '+221', 'africa',
    18.00, 'TVA',
    ARRAY['wave','orange-money','stripe'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'CI', 'Ivory Coast', 'Côte d''Ivoire', 'ساحل العاج',
    'XOF', 'CFA', 0,
    'fr-CI', ARRAY['en'],
    'Africa/Abidjan', '+225', 'africa',
    18.00, 'TVA',
    ARRAY['wave','mtn-momo','stripe'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'NG', 'Nigeria', 'Nigéria', 'نيجيريا',
    'NGN', '₦', 2,
    'en-NG', ARRAY['fr'],
    'Africa/Lagos', '+234', 'africa',
    7.50, 'VAT',
    ARRAY['paystack','flutterwave','stripe'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  ),
  (
    'KE', 'Kenya', 'Kenya', 'كينيا',
    'KES', 'KSh', 2,
    'en-KE', ARRAY['sw','fr'],
    'Africa/Nairobi', '+254', 'africa',
    16.00, 'VAT',
    ARRAY['mpesa','stripe'],
    ARRAY['whatsapp','messenger'],
    '{}'::jsonb
  )
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. TABLE: public.verticals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verticals (
  slug                text PRIMARY KEY,
  category            text NOT NULL CHECK (category IN ('health','beauty','food','finance','public','retail','education','services')),
  name_en             text NOT NULL,
  name_fr             text NOT NULL,
  name_ar             text NOT NULL,
  default_modules     text[] NOT NULL DEFAULT '{}',
  default_terminology jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- RLS on verticals
ALTER TABLE public.verticals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "verticals_select_authenticated" ON public.verticals;
CREATE POLICY "verticals_select_authenticated"
  ON public.verticals
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 4. SEED: verticals (15 verticals)
-- ============================================================
INSERT INTO public.verticals (slug, category, name_en, name_fr, name_ar, default_modules, default_terminology) VALUES
  (
    'clinic', 'health',
    'Medical Clinic', 'Clinique médicale', 'عيادة طبية',
    ARRAY['queue','booking','pos'],
    '{"customer":"patient","customers":"patients","booking":"appointment","bookings":"appointments","staff":"doctor","queue_item":"consultation"}'::jsonb
  ),
  (
    'dental', 'health',
    'Dental Clinic', 'Cabinet dentaire', 'عيادة أسنان',
    ARRAY['queue','booking','pos'],
    '{"customer":"patient","customers":"patients","booking":"appointment","bookings":"appointments","staff":"dentist","queue_item":"consultation"}'::jsonb
  ),
  (
    'pharmacy', 'health',
    'Pharmacy', 'Pharmacie', 'صيدلية',
    ARRAY['queue','pos'],
    '{"customer":"customer","customers":"customers","booking":"order","bookings":"orders","staff":"pharmacist","queue_item":"prescription"}'::jsonb
  ),
  (
    'veterinary', 'health',
    'Veterinary Clinic', 'Clinique vétérinaire', 'عيادة بيطرية',
    ARRAY['queue','booking','pos'],
    '{"customer":"pet owner","customers":"pet owners","booking":"appointment","bookings":"appointments","staff":"vet","queue_item":"consultation"}'::jsonb
  ),
  (
    'salon', 'beauty',
    'Hair Salon', 'Salon de coiffure', 'صالون تجميل',
    ARRAY['queue','booking','pos'],
    '{"customer":"client","customers":"clients","booking":"appointment","bookings":"appointments","staff":"stylist","queue_item":"service"}'::jsonb
  ),
  (
    'spa', 'beauty',
    'Spa & Wellness', 'Spa & Bien-être', 'سبا وعافية',
    ARRAY['queue','booking','pos'],
    '{"customer":"guest","customers":"guests","booking":"session","bookings":"sessions","staff":"therapist","queue_item":"treatment"}'::jsonb
  ),
  (
    'barber', 'beauty',
    'Barbershop', 'Barbier', 'حلاق',
    ARRAY['queue','booking','pos'],
    '{"customer":"client","customers":"clients","booking":"appointment","bookings":"appointments","staff":"barber","queue_item":"haircut"}'::jsonb
  ),
  (
    'restaurant', 'food',
    'Restaurant', 'Restaurant', 'مطعم',
    ARRAY['queue','booking','pos','tables'],
    '{"customer":"guest","customers":"guests","booking":"reservation","bookings":"reservations","staff":"waiter","queue_item":"table"}'::jsonb
  ),
  (
    'bank', 'finance',
    'Bank', 'Banque', 'بنك',
    ARRAY['queue','booking'],
    '{"customer":"customer","customers":"customers","booking":"appointment","bookings":"appointments","staff":"agent","queue_item":"transaction"}'::jsonb
  ),
  (
    'gov', 'public',
    'Government Office', 'Administration publique', 'مكتب حكومي',
    ARRAY['queue','booking'],
    '{"customer":"citizen","customers":"citizens","booking":"appointment","bookings":"appointments","staff":"agent","queue_item":"request"}'::jsonb
  ),
  (
    'public-service', 'public',
    'Public Service', 'Service public', 'خدمة عامة',
    ARRAY['queue','booking'],
    '{"customer":"citizen","customers":"citizens","booking":"appointment","bookings":"appointments","staff":"agent","queue_item":"request"}'::jsonb
  ),
  (
    'retail', 'retail',
    'Retail Store', 'Magasin', 'متجر',
    ARRAY['queue','pos'],
    '{"customer":"customer","customers":"customers","booking":"order","bookings":"orders","staff":"associate","queue_item":"service"}'::jsonb
  ),
  (
    'telecom', 'retail',
    'Telecom Store', 'Boutique télécom', 'متجر اتصالات',
    ARRAY['queue','booking','pos'],
    '{"customer":"customer","customers":"customers","booking":"appointment","bookings":"appointments","staff":"agent","queue_item":"service"}'::jsonb
  ),
  (
    'automotive', 'services',
    'Auto Service', 'Garage automobile', 'خدمة سيارات',
    ARRAY['queue','booking','pos'],
    '{"customer":"customer","customers":"customers","booking":"appointment","bookings":"appointments","staff":"mechanic","queue_item":"service"}'::jsonb
  ),
  (
    'education', 'education',
    'Education', 'Éducation', 'تعليم',
    ARRAY['queue','booking'],
    '{"customer":"student","customers":"students","booking":"session","bookings":"sessions","staff":"teacher","queue_item":"session"}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 5. ALTER: public.organizations — add columns (nullable first)
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS country            text,
  ADD COLUMN IF NOT EXISTS vertical           text,
  ADD COLUMN IF NOT EXISTS locale_primary     text,
  ADD COLUMN IF NOT EXISTS locale_fallbacks   text[],
  ADD COLUMN IF NOT EXISTS timezone           text,
  ADD COLUMN IF NOT EXISTS currency_override  text;

-- ============================================================
-- 6. BACKFILL: existing orgs → DZ / restaurant
-- ============================================================
UPDATE public.organizations
SET
  country  = 'DZ',
  vertical = 'restaurant'
WHERE country IS NULL OR vertical IS NULL;

-- ============================================================
-- 7. ADD FOREIGN KEY CONSTRAINTS (after backfill so data is valid)
-- ============================================================
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_country_fkey,
  ADD  CONSTRAINT organizations_country_fkey
       FOREIGN KEY (country) REFERENCES public.country_config(code);

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_vertical_fkey,
  ADD  CONSTRAINT organizations_vertical_fkey
       FOREIGN KEY (vertical) REFERENCES public.verticals(slug);

-- ============================================================
-- 8. INDEXES on organizations(country) and organizations(vertical)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_organizations_country  ON public.organizations (country);
CREATE INDEX IF NOT EXISTS idx_organizations_vertical ON public.organizations (vertical);
