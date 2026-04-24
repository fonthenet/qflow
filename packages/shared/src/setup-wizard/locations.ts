/**
 * Countries + major cities used by the setup wizard's location picker.
 *
 * Selecting a city in the wizard auto-derives the IANA timezone so the
 * operator never has to know "Africa/Algiers" or "America/Los_Angeles".
 *
 * Coverage priority:
 *   1. Qflo target markets (North Africa, MENA, Francophone Africa, Europe).
 *   2. Major global business centers so the wizard still works worldwide.
 *
 * Adding a country or city is a one-file edit here.
 */

import type { LocalizedText } from './categories';

export interface CityEntry {
  name: LocalizedText;
  timezone: string;
}

export interface CountryEntry {
  /** ISO-3166 alpha-2. */
  code: string;
  name: LocalizedText;
  flag: string;
  /** Fallback timezone when a custom city is typed. */
  defaultTimezone: string;
  /** Curated list of major cities. Ordered roughly by population / business importance. */
  cities: CityEntry[];
}

// Helper to keep declarations tidy.
const L = (en: string, fr: string, ar: string): LocalizedText => ({ en, fr, ar });

export const COUNTRIES: CountryEntry[] = [
  // ── North Africa (primary markets) ──────────────────────────────
  {
    code: 'DZ', flag: '🇩🇿', name: L('Algeria', 'Algérie', 'الجزائر'),
    defaultTimezone: 'Africa/Algiers',
    cities: [
      { name: L('Algiers', 'Alger', 'الجزائر'), timezone: 'Africa/Algiers' },
      { name: L('Oran', 'Oran', 'وهران'), timezone: 'Africa/Algiers' },
      { name: L('Constantine', 'Constantine', 'قسنطينة'), timezone: 'Africa/Algiers' },
      { name: L('Annaba', 'Annaba', 'عنابة'), timezone: 'Africa/Algiers' },
      { name: L('Blida', 'Blida', 'البليدة'), timezone: 'Africa/Algiers' },
      { name: L('Batna', 'Batna', 'باتنة'), timezone: 'Africa/Algiers' },
      { name: L('Setif', 'Sétif', 'سطيف'), timezone: 'Africa/Algiers' },
      { name: L('Tizi Ouzou', 'Tizi Ouzou', 'تيزي وزو'), timezone: 'Africa/Algiers' },
      { name: L('Tlemcen', 'Tlemcen', 'تلمسان'), timezone: 'Africa/Algiers' },
      { name: L('Djelfa', 'Djelfa', 'الجلفة'), timezone: 'Africa/Algiers' },
    ],
  },
  {
    code: 'MA', flag: '🇲🇦', name: L('Morocco', 'Maroc', 'المغرب'),
    defaultTimezone: 'Africa/Casablanca',
    cities: [
      { name: L('Casablanca', 'Casablanca', 'الدار البيضاء'), timezone: 'Africa/Casablanca' },
      { name: L('Rabat', 'Rabat', 'الرباط'), timezone: 'Africa/Casablanca' },
      { name: L('Marrakech', 'Marrakech', 'مراكش'), timezone: 'Africa/Casablanca' },
      { name: L('Fes', 'Fès', 'فاس'), timezone: 'Africa/Casablanca' },
      { name: L('Tangier', 'Tanger', 'طنجة'), timezone: 'Africa/Casablanca' },
      { name: L('Agadir', 'Agadir', 'أكادير'), timezone: 'Africa/Casablanca' },
      { name: L('Meknes', 'Meknès', 'مكناس'), timezone: 'Africa/Casablanca' },
      { name: L('Oujda', 'Oujda', 'وجدة'), timezone: 'Africa/Casablanca' },
    ],
  },
  {
    code: 'TN', flag: '🇹🇳', name: L('Tunisia', 'Tunisie', 'تونس'),
    defaultTimezone: 'Africa/Tunis',
    cities: [
      { name: L('Tunis', 'Tunis', 'تونس'), timezone: 'Africa/Tunis' },
      { name: L('Sfax', 'Sfax', 'صفاقس'), timezone: 'Africa/Tunis' },
      { name: L('Sousse', 'Sousse', 'سوسة'), timezone: 'Africa/Tunis' },
      { name: L('Kairouan', 'Kairouan', 'القيروان'), timezone: 'Africa/Tunis' },
      { name: L('Bizerte', 'Bizerte', 'بنزرت'), timezone: 'Africa/Tunis' },
    ],
  },
  {
    code: 'EG', flag: '🇪🇬', name: L('Egypt', 'Égypte', 'مصر'),
    defaultTimezone: 'Africa/Cairo',
    cities: [
      { name: L('Cairo', 'Le Caire', 'القاهرة'), timezone: 'Africa/Cairo' },
      { name: L('Alexandria', 'Alexandrie', 'الإسكندرية'), timezone: 'Africa/Cairo' },
      { name: L('Giza', 'Gizeh', 'الجيزة'), timezone: 'Africa/Cairo' },
      { name: L('Sharm El Sheikh', 'Charm el-Cheikh', 'شرم الشيخ'), timezone: 'Africa/Cairo' },
      { name: L('Luxor', 'Louxor', 'الأقصر'), timezone: 'Africa/Cairo' },
    ],
  },
  {
    code: 'LY', flag: '🇱🇾', name: L('Libya', 'Libye', 'ليبيا'),
    defaultTimezone: 'Africa/Tripoli',
    cities: [
      { name: L('Tripoli', 'Tripoli', 'طرابلس'), timezone: 'Africa/Tripoli' },
      { name: L('Benghazi', 'Benghazi', 'بنغازي'), timezone: 'Africa/Tripoli' },
      { name: L('Misrata', 'Misrata', 'مصراتة'), timezone: 'Africa/Tripoli' },
    ],
  },

  // ── Gulf / Middle East ──────────────────────────────────────────
  {
    code: 'SA', flag: '🇸🇦', name: L('Saudi Arabia', 'Arabie Saoudite', 'السعودية'),
    defaultTimezone: 'Asia/Riyadh',
    cities: [
      { name: L('Riyadh', 'Riyad', 'الرياض'), timezone: 'Asia/Riyadh' },
      { name: L('Jeddah', 'Djeddah', 'جدة'), timezone: 'Asia/Riyadh' },
      { name: L('Mecca', 'La Mecque', 'مكة المكرمة'), timezone: 'Asia/Riyadh' },
      { name: L('Medina', 'Médine', 'المدينة المنورة'), timezone: 'Asia/Riyadh' },
      { name: L('Dammam', 'Dammam', 'الدمام'), timezone: 'Asia/Riyadh' },
      { name: L('Khobar', 'Khobar', 'الخبر'), timezone: 'Asia/Riyadh' },
    ],
  },
  {
    code: 'AE', flag: '🇦🇪', name: L('United Arab Emirates', 'Émirats arabes unis', 'الإمارات'),
    defaultTimezone: 'Asia/Dubai',
    cities: [
      { name: L('Dubai', 'Dubaï', 'دبي'), timezone: 'Asia/Dubai' },
      { name: L('Abu Dhabi', 'Abou Dabi', 'أبو ظبي'), timezone: 'Asia/Dubai' },
      { name: L('Sharjah', 'Charjah', 'الشارقة'), timezone: 'Asia/Dubai' },
      { name: L('Ajman', 'Ajman', 'عجمان'), timezone: 'Asia/Dubai' },
      { name: L('Ras Al Khaimah', 'Ras el Khaïmah', 'رأس الخيمة'), timezone: 'Asia/Dubai' },
    ],
  },
  {
    code: 'QA', flag: '🇶🇦', name: L('Qatar', 'Qatar', 'قطر'),
    defaultTimezone: 'Asia/Qatar',
    cities: [
      { name: L('Doha', 'Doha', 'الدوحة'), timezone: 'Asia/Qatar' },
      { name: L('Al Rayyan', 'Al Rayyan', 'الريان'), timezone: 'Asia/Qatar' },
    ],
  },
  {
    code: 'KW', flag: '🇰🇼', name: L('Kuwait', 'Koweït', 'الكويت'),
    defaultTimezone: 'Asia/Kuwait',
    cities: [
      { name: L('Kuwait City', 'Koweït', 'مدينة الكويت'), timezone: 'Asia/Kuwait' },
      { name: L('Hawalli', 'Hawalli', 'حولي'), timezone: 'Asia/Kuwait' },
    ],
  },
  {
    code: 'BH', flag: '🇧🇭', name: L('Bahrain', 'Bahreïn', 'البحرين'),
    defaultTimezone: 'Asia/Bahrain',
    cities: [
      { name: L('Manama', 'Manama', 'المنامة'), timezone: 'Asia/Bahrain' },
      { name: L('Riffa', 'Riffa', 'الرفاع'), timezone: 'Asia/Bahrain' },
    ],
  },
  {
    code: 'OM', flag: '🇴🇲', name: L('Oman', 'Oman', 'عُمان'),
    defaultTimezone: 'Asia/Muscat',
    cities: [
      { name: L('Muscat', 'Mascate', 'مسقط'), timezone: 'Asia/Muscat' },
      { name: L('Salalah', 'Salalah', 'صلالة'), timezone: 'Asia/Muscat' },
    ],
  },
  {
    code: 'JO', flag: '🇯🇴', name: L('Jordan', 'Jordanie', 'الأردن'),
    defaultTimezone: 'Asia/Amman',
    cities: [
      { name: L('Amman', 'Amman', 'عمّان'), timezone: 'Asia/Amman' },
      { name: L('Zarqa', 'Zarqa', 'الزرقاء'), timezone: 'Asia/Amman' },
      { name: L('Irbid', 'Irbid', 'إربد'), timezone: 'Asia/Amman' },
    ],
  },
  {
    code: 'LB', flag: '🇱🇧', name: L('Lebanon', 'Liban', 'لبنان'),
    defaultTimezone: 'Asia/Beirut',
    cities: [
      { name: L('Beirut', 'Beyrouth', 'بيروت'), timezone: 'Asia/Beirut' },
      { name: L('Tripoli', 'Tripoli', 'طرابلس'), timezone: 'Asia/Beirut' },
    ],
  },
  {
    code: 'TR', flag: '🇹🇷', name: L('Turkey', 'Turquie', 'تركيا'),
    defaultTimezone: 'Europe/Istanbul',
    cities: [
      { name: L('Istanbul', 'Istanbul', 'إسطنبول'), timezone: 'Europe/Istanbul' },
      { name: L('Ankara', 'Ankara', 'أنقرة'), timezone: 'Europe/Istanbul' },
      { name: L('Izmir', 'Izmir', 'إزمير'), timezone: 'Europe/Istanbul' },
      { name: L('Antalya', 'Antalya', 'أنطاليا'), timezone: 'Europe/Istanbul' },
    ],
  },

  // ── West / Sub-Saharan Africa ───────────────────────────────────
  {
    code: 'SN', flag: '🇸🇳', name: L('Senegal', 'Sénégal', 'السنغال'),
    defaultTimezone: 'Africa/Dakar',
    cities: [
      { name: L('Dakar', 'Dakar', 'داكار'), timezone: 'Africa/Dakar' },
      { name: L('Thiès', 'Thiès', 'تياس'), timezone: 'Africa/Dakar' },
    ],
  },
  {
    code: 'CI', flag: '🇨🇮', name: L("Côte d'Ivoire", "Côte d'Ivoire", 'ساحل العاج'),
    defaultTimezone: 'Africa/Abidjan',
    cities: [
      { name: L('Abidjan', 'Abidjan', 'أبيدجان'), timezone: 'Africa/Abidjan' },
      { name: L('Yamoussoukro', 'Yamoussoukro', 'ياموسوكرو'), timezone: 'Africa/Abidjan' },
    ],
  },
  {
    code: 'NG', flag: '🇳🇬', name: L('Nigeria', 'Nigéria', 'نيجيريا'),
    defaultTimezone: 'Africa/Lagos',
    cities: [
      { name: L('Lagos', 'Lagos', 'لاغوس'), timezone: 'Africa/Lagos' },
      { name: L('Abuja', 'Abuja', 'أبوجا'), timezone: 'Africa/Lagos' },
      { name: L('Kano', 'Kano', 'كانو'), timezone: 'Africa/Lagos' },
      { name: L('Port Harcourt', 'Port Harcourt', 'بورت هاركورت'), timezone: 'Africa/Lagos' },
    ],
  },
  {
    code: 'GH', flag: '🇬🇭', name: L('Ghana', 'Ghana', 'غانا'),
    defaultTimezone: 'Africa/Accra',
    cities: [
      { name: L('Accra', 'Accra', 'أكرا'), timezone: 'Africa/Accra' },
      { name: L('Kumasi', 'Kumasi', 'كوماسي'), timezone: 'Africa/Accra' },
    ],
  },
  {
    code: 'KE', flag: '🇰🇪', name: L('Kenya', 'Kenya', 'كينيا'),
    defaultTimezone: 'Africa/Nairobi',
    cities: [
      { name: L('Nairobi', 'Nairobi', 'نيروبي'), timezone: 'Africa/Nairobi' },
      { name: L('Mombasa', 'Mombasa', 'مومباسا'), timezone: 'Africa/Nairobi' },
    ],
  },
  {
    code: 'ZA', flag: '🇿🇦', name: L('South Africa', 'Afrique du Sud', 'جنوب أفريقيا'),
    defaultTimezone: 'Africa/Johannesburg',
    cities: [
      { name: L('Johannesburg', 'Johannesbourg', 'جوهانسبرغ'), timezone: 'Africa/Johannesburg' },
      { name: L('Cape Town', 'Le Cap', 'كيب تاون'), timezone: 'Africa/Johannesburg' },
      { name: L('Durban', 'Durban', 'ديربان'), timezone: 'Africa/Johannesburg' },
      { name: L('Pretoria', 'Pretoria', 'بريتوريا'), timezone: 'Africa/Johannesburg' },
    ],
  },

  // ── Europe ──────────────────────────────────────────────────────
  {
    code: 'FR', flag: '🇫🇷', name: L('France', 'France', 'فرنسا'),
    defaultTimezone: 'Europe/Paris',
    cities: [
      { name: L('Paris', 'Paris', 'باريس'), timezone: 'Europe/Paris' },
      { name: L('Marseille', 'Marseille', 'مرسيليا'), timezone: 'Europe/Paris' },
      { name: L('Lyon', 'Lyon', 'ليون'), timezone: 'Europe/Paris' },
      { name: L('Toulouse', 'Toulouse', 'تولوز'), timezone: 'Europe/Paris' },
      { name: L('Nice', 'Nice', 'نيس'), timezone: 'Europe/Paris' },
      { name: L('Bordeaux', 'Bordeaux', 'بوردو'), timezone: 'Europe/Paris' },
      { name: L('Lille', 'Lille', 'ليل'), timezone: 'Europe/Paris' },
      { name: L('Strasbourg', 'Strasbourg', 'ستراسبورغ'), timezone: 'Europe/Paris' },
    ],
  },
  {
    code: 'BE', flag: '🇧🇪', name: L('Belgium', 'Belgique', 'بلجيكا'),
    defaultTimezone: 'Europe/Brussels',
    cities: [
      { name: L('Brussels', 'Bruxelles', 'بروكسل'), timezone: 'Europe/Brussels' },
      { name: L('Antwerp', 'Anvers', 'أنتويرب'), timezone: 'Europe/Brussels' },
      { name: L('Liège', 'Liège', 'لييج'), timezone: 'Europe/Brussels' },
    ],
  },
  {
    code: 'CH', flag: '🇨🇭', name: L('Switzerland', 'Suisse', 'سويسرا'),
    defaultTimezone: 'Europe/Zurich',
    cities: [
      { name: L('Zurich', 'Zurich', 'زيورخ'), timezone: 'Europe/Zurich' },
      { name: L('Geneva', 'Genève', 'جنيف'), timezone: 'Europe/Zurich' },
      { name: L('Basel', 'Bâle', 'بازل'), timezone: 'Europe/Zurich' },
      { name: L('Lausanne', 'Lausanne', 'لوزان'), timezone: 'Europe/Zurich' },
    ],
  },
  {
    code: 'ES', flag: '🇪🇸', name: L('Spain', 'Espagne', 'إسبانيا'),
    defaultTimezone: 'Europe/Madrid',
    cities: [
      { name: L('Madrid', 'Madrid', 'مدريد'), timezone: 'Europe/Madrid' },
      { name: L('Barcelona', 'Barcelone', 'برشلونة'), timezone: 'Europe/Madrid' },
      { name: L('Valencia', 'Valence', 'فالنسيا'), timezone: 'Europe/Madrid' },
      { name: L('Seville', 'Séville', 'إشبيلية'), timezone: 'Europe/Madrid' },
    ],
  },
  {
    code: 'IT', flag: '🇮🇹', name: L('Italy', 'Italie', 'إيطاليا'),
    defaultTimezone: 'Europe/Rome',
    cities: [
      { name: L('Rome', 'Rome', 'روما'), timezone: 'Europe/Rome' },
      { name: L('Milan', 'Milan', 'ميلانو'), timezone: 'Europe/Rome' },
      { name: L('Naples', 'Naples', 'نابولي'), timezone: 'Europe/Rome' },
      { name: L('Turin', 'Turin', 'تورينو'), timezone: 'Europe/Rome' },
    ],
  },
  {
    code: 'DE', flag: '🇩🇪', name: L('Germany', 'Allemagne', 'ألمانيا'),
    defaultTimezone: 'Europe/Berlin',
    cities: [
      { name: L('Berlin', 'Berlin', 'برلين'), timezone: 'Europe/Berlin' },
      { name: L('Munich', 'Munich', 'ميونخ'), timezone: 'Europe/Berlin' },
      { name: L('Hamburg', 'Hambourg', 'هامبورغ'), timezone: 'Europe/Berlin' },
      { name: L('Frankfurt', 'Francfort', 'فرانكفورت'), timezone: 'Europe/Berlin' },
      { name: L('Cologne', 'Cologne', 'كولونيا'), timezone: 'Europe/Berlin' },
    ],
  },
  {
    code: 'NL', flag: '🇳🇱', name: L('Netherlands', 'Pays-Bas', 'هولندا'),
    defaultTimezone: 'Europe/Amsterdam',
    cities: [
      { name: L('Amsterdam', 'Amsterdam', 'أمستردام'), timezone: 'Europe/Amsterdam' },
      { name: L('Rotterdam', 'Rotterdam', 'روتردام'), timezone: 'Europe/Amsterdam' },
      { name: L('The Hague', 'La Haye', 'لاهاي'), timezone: 'Europe/Amsterdam' },
    ],
  },
  {
    code: 'PT', flag: '🇵🇹', name: L('Portugal', 'Portugal', 'البرتغال'),
    defaultTimezone: 'Europe/Lisbon',
    cities: [
      { name: L('Lisbon', 'Lisbonne', 'لشبونة'), timezone: 'Europe/Lisbon' },
      { name: L('Porto', 'Porto', 'بورتو'), timezone: 'Europe/Lisbon' },
    ],
  },
  {
    code: 'GB', flag: '🇬🇧', name: L('United Kingdom', 'Royaume-Uni', 'المملكة المتحدة'),
    defaultTimezone: 'Europe/London',
    cities: [
      { name: L('London', 'Londres', 'لندن'), timezone: 'Europe/London' },
      { name: L('Manchester', 'Manchester', 'مانشستر'), timezone: 'Europe/London' },
      { name: L('Birmingham', 'Birmingham', 'برمنغهام'), timezone: 'Europe/London' },
      { name: L('Edinburgh', 'Édimbourg', 'إدنبرة'), timezone: 'Europe/London' },
      { name: L('Glasgow', 'Glasgow', 'غلاسكو'), timezone: 'Europe/London' },
    ],
  },

  // ── Americas ────────────────────────────────────────────────────
  {
    code: 'US', flag: '🇺🇸', name: L('United States', 'États-Unis', 'الولايات المتحدة'),
    defaultTimezone: 'America/New_York',
    cities: [
      { name: L('New York', 'New York', 'نيويورك'), timezone: 'America/New_York' },
      { name: L('Los Angeles', 'Los Angeles', 'لوس أنجلوس'), timezone: 'America/Los_Angeles' },
      { name: L('Chicago', 'Chicago', 'شيكاغو'), timezone: 'America/Chicago' },
      { name: L('Houston', 'Houston', 'هيوستن'), timezone: 'America/Chicago' },
      { name: L('Phoenix', 'Phoenix', 'فينيكس'), timezone: 'America/Phoenix' },
      { name: L('Philadelphia', 'Philadelphie', 'فيلادلفيا'), timezone: 'America/New_York' },
      { name: L('San Antonio', 'San Antonio', 'سان أنطونيو'), timezone: 'America/Chicago' },
      { name: L('San Diego', 'San Diego', 'سان دييغو'), timezone: 'America/Los_Angeles' },
      { name: L('Dallas', 'Dallas', 'دالاس'), timezone: 'America/Chicago' },
      { name: L('San Francisco', 'San Francisco', 'سان فرانسيسكو'), timezone: 'America/Los_Angeles' },
      { name: L('Seattle', 'Seattle', 'سياتل'), timezone: 'America/Los_Angeles' },
      { name: L('Denver', 'Denver', 'دنفر'), timezone: 'America/Denver' },
      { name: L('Miami', 'Miami', 'ميامي'), timezone: 'America/New_York' },
      { name: L('Atlanta', 'Atlanta', 'أتلانتا'), timezone: 'America/New_York' },
      { name: L('Boston', 'Boston', 'بوسطن'), timezone: 'America/New_York' },
      { name: L('Detroit', 'Détroit', 'ديترويت'), timezone: 'America/Detroit' },
    ],
  },
  {
    code: 'CA', flag: '🇨🇦', name: L('Canada', 'Canada', 'كندا'),
    defaultTimezone: 'America/Toronto',
    cities: [
      { name: L('Toronto', 'Toronto', 'تورنتو'), timezone: 'America/Toronto' },
      { name: L('Montreal', 'Montréal', 'مونتريال'), timezone: 'America/Toronto' },
      { name: L('Vancouver', 'Vancouver', 'فانكوفر'), timezone: 'America/Vancouver' },
      { name: L('Calgary', 'Calgary', 'كالغاري'), timezone: 'America/Edmonton' },
      { name: L('Ottawa', 'Ottawa', 'أوتاوا'), timezone: 'America/Toronto' },
      { name: L('Edmonton', 'Edmonton', 'إدمنتون'), timezone: 'America/Edmonton' },
      { name: L('Quebec City', 'Québec', 'مدينة كيبك'), timezone: 'America/Toronto' },
    ],
  },
  {
    code: 'MX', flag: '🇲🇽', name: L('Mexico', 'Mexique', 'المكسيك'),
    defaultTimezone: 'America/Mexico_City',
    cities: [
      { name: L('Mexico City', 'Mexico', 'مكسيكو سيتي'), timezone: 'America/Mexico_City' },
      { name: L('Guadalajara', 'Guadalajara', 'غوادالاخارا'), timezone: 'America/Mexico_City' },
      { name: L('Monterrey', 'Monterrey', 'مونتيري'), timezone: 'America/Monterrey' },
    ],
  },
  {
    code: 'BR', flag: '🇧🇷', name: L('Brazil', 'Brésil', 'البرازيل'),
    defaultTimezone: 'America/Sao_Paulo',
    cities: [
      { name: L('São Paulo', 'São Paulo', 'ساو باولو'), timezone: 'America/Sao_Paulo' },
      { name: L('Rio de Janeiro', 'Rio de Janeiro', 'ريو دي جانيرو'), timezone: 'America/Sao_Paulo' },
      { name: L('Brasília', 'Brasília', 'برازيليا'), timezone: 'America/Sao_Paulo' },
    ],
  },

  // ── Asia ────────────────────────────────────────────────────────
  {
    code: 'IN', flag: '🇮🇳', name: L('India', 'Inde', 'الهند'),
    defaultTimezone: 'Asia/Kolkata',
    cities: [
      { name: L('Mumbai', 'Mumbai', 'مومباي'), timezone: 'Asia/Kolkata' },
      { name: L('Delhi', 'Delhi', 'دلهي'), timezone: 'Asia/Kolkata' },
      { name: L('Bangalore', 'Bangalore', 'بنغالور'), timezone: 'Asia/Kolkata' },
      { name: L('Chennai', 'Chennai', 'تشيناي'), timezone: 'Asia/Kolkata' },
      { name: L('Hyderabad', 'Hyderabad', 'حيدر أباد'), timezone: 'Asia/Kolkata' },
      { name: L('Kolkata', 'Calcutta', 'كولكاتا'), timezone: 'Asia/Kolkata' },
      { name: L('Pune', 'Pune', 'بونا'), timezone: 'Asia/Kolkata' },
    ],
  },
  {
    code: 'PK', flag: '🇵🇰', name: L('Pakistan', 'Pakistan', 'باكستان'),
    defaultTimezone: 'Asia/Karachi',
    cities: [
      { name: L('Karachi', 'Karachi', 'كراتشي'), timezone: 'Asia/Karachi' },
      { name: L('Lahore', 'Lahore', 'لاهور'), timezone: 'Asia/Karachi' },
      { name: L('Islamabad', 'Islamabad', 'إسلام آباد'), timezone: 'Asia/Karachi' },
    ],
  },
  {
    code: 'ID', flag: '🇮🇩', name: L('Indonesia', 'Indonésie', 'إندونيسيا'),
    defaultTimezone: 'Asia/Jakarta',
    cities: [
      { name: L('Jakarta', 'Jakarta', 'جاكرتا'), timezone: 'Asia/Jakarta' },
      { name: L('Surabaya', 'Surabaya', 'سورابايا'), timezone: 'Asia/Jakarta' },
      { name: L('Bandung', 'Bandung', 'باندونغ'), timezone: 'Asia/Jakarta' },
    ],
  },
  {
    code: 'MY', flag: '🇲🇾', name: L('Malaysia', 'Malaisie', 'ماليزيا'),
    defaultTimezone: 'Asia/Kuala_Lumpur',
    cities: [
      { name: L('Kuala Lumpur', 'Kuala Lumpur', 'كوالالمبور'), timezone: 'Asia/Kuala_Lumpur' },
      { name: L('George Town', 'George Town', 'جورج تاون'), timezone: 'Asia/Kuala_Lumpur' },
    ],
  },
  {
    code: 'SG', flag: '🇸🇬', name: L('Singapore', 'Singapour', 'سنغافورة'),
    defaultTimezone: 'Asia/Singapore',
    cities: [
      { name: L('Singapore', 'Singapour', 'سنغافورة'), timezone: 'Asia/Singapore' },
    ],
  },
  {
    code: 'PH', flag: '🇵🇭', name: L('Philippines', 'Philippines', 'الفلبين'),
    defaultTimezone: 'Asia/Manila',
    cities: [
      { name: L('Manila', 'Manille', 'مانيلا'), timezone: 'Asia/Manila' },
      { name: L('Cebu City', 'Cebu', 'مدينة سيبو'), timezone: 'Asia/Manila' },
    ],
  },
  {
    code: 'VN', flag: '🇻🇳', name: L('Vietnam', 'Viêt Nam', 'فيتنام'),
    defaultTimezone: 'Asia/Ho_Chi_Minh',
    cities: [
      { name: L('Ho Chi Minh City', 'Hô-Chi-Minh-Ville', 'مدينة هو تشي مينه'), timezone: 'Asia/Ho_Chi_Minh' },
      { name: L('Hanoi', 'Hanoï', 'هانوي'), timezone: 'Asia/Ho_Chi_Minh' },
    ],
  },
  {
    code: 'TH', flag: '🇹🇭', name: L('Thailand', 'Thaïlande', 'تايلاند'),
    defaultTimezone: 'Asia/Bangkok',
    cities: [
      { name: L('Bangkok', 'Bangkok', 'بانكوك'), timezone: 'Asia/Bangkok' },
      { name: L('Chiang Mai', 'Chiang Mai', 'شيانغ ماي'), timezone: 'Asia/Bangkok' },
    ],
  },
  {
    code: 'JP', flag: '🇯🇵', name: L('Japan', 'Japon', 'اليابان'),
    defaultTimezone: 'Asia/Tokyo',
    cities: [
      { name: L('Tokyo', 'Tokyo', 'طوكيو'), timezone: 'Asia/Tokyo' },
      { name: L('Osaka', 'Osaka', 'أوساكا'), timezone: 'Asia/Tokyo' },
      { name: L('Kyoto', 'Kyoto', 'كيوتو'), timezone: 'Asia/Tokyo' },
    ],
  },
  {
    code: 'KR', flag: '🇰🇷', name: L('South Korea', 'Corée du Sud', 'كوريا الجنوبية'),
    defaultTimezone: 'Asia/Seoul',
    cities: [
      { name: L('Seoul', 'Séoul', 'سيول'), timezone: 'Asia/Seoul' },
      { name: L('Busan', 'Busan', 'بوسان'), timezone: 'Asia/Seoul' },
    ],
  },

  // ── Oceania ─────────────────────────────────────────────────────
  {
    code: 'AU', flag: '🇦🇺', name: L('Australia', 'Australie', 'أستراليا'),
    defaultTimezone: 'Australia/Sydney',
    cities: [
      { name: L('Sydney', 'Sydney', 'سيدني'), timezone: 'Australia/Sydney' },
      { name: L('Melbourne', 'Melbourne', 'ملبورن'), timezone: 'Australia/Melbourne' },
      { name: L('Brisbane', 'Brisbane', 'بريسبن'), timezone: 'Australia/Brisbane' },
      { name: L('Perth', 'Perth', 'بيرث'), timezone: 'Australia/Perth' },
      { name: L('Adelaide', 'Adélaïde', 'أديلايد'), timezone: 'Australia/Adelaide' },
    ],
  },
  {
    code: 'NZ', flag: '🇳🇿', name: L('New Zealand', 'Nouvelle-Zélande', 'نيوزيلندا'),
    defaultTimezone: 'Pacific/Auckland',
    cities: [
      { name: L('Auckland', 'Auckland', 'أوكلاند'), timezone: 'Pacific/Auckland' },
      { name: L('Wellington', 'Wellington', 'ويلينغتون'), timezone: 'Pacific/Auckland' },
    ],
  },
];

/**
 * Lookup a country by ISO-2 code.
 */
export function getCountry(code: string | null | undefined): CountryEntry | null {
  if (!code) return null;
  const c = COUNTRIES.find((x) => x.code.toLowerCase() === code.toLowerCase());
  return c ?? null;
}

/**
 * Try to guess the default country from the browser timezone.
 * Returns null if no country in the list matches.
 */
export function detectDefaultCountry(): CountryEntry | null {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
  if (!tz) return null;
  // Exact-match a city first (e.g. "America/Los_Angeles" → US).
  const byCity = COUNTRIES.find((c) => c.cities.some((city) => city.timezone === tz));
  if (byCity) return byCity;
  // Then fall back to country default tz.
  const byCountry = COUNTRIES.find((c) => c.defaultTimezone === tz);
  return byCountry ?? null;
}
