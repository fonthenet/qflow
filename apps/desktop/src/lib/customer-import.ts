// Customer import helpers: Excel/CSV parsing and Google Sheets fetch.
// XLSX is loaded lazily from a CDN to avoid bundling a large dep.

export interface ParsedCustomerRow {
  name?: string;
  phone?: string;
  email?: string;
  gender?: string;
  date_of_birth?: string;
  blood_type?: string;
  file_number?: string;
  address?: string;
  wilaya_code?: string;
  city?: string;
  notes?: string;
  is_couple?: boolean;
  spouse_name?: string;
  spouse_dob?: string;
  spouse_blood_type?: string;
  spouse_gender?: string;
  marriage_date?: string;
}

const FIELD_ALIASES: Record<string, keyof ParsedCustomerRow> = {
  name: 'name', nom: 'name', 'full name': 'name', 'nom complet': 'name', 'اسم': 'name',
  phone: 'phone', telephone: 'phone', 'téléphone': 'phone', tel: 'phone', mobile: 'phone', 'هاتف': 'phone',
  email: 'email', mail: 'email', 'e-mail': 'email', 'courriel': 'email',
  gender: 'gender', sexe: 'gender', genre: 'gender', 'الجنس': 'gender',
  dob: 'date_of_birth', birthday: 'date_of_birth', birthdate: 'date_of_birth', 'date of birth': 'date_of_birth', 'date de naissance': 'date_of_birth', 'ddn': 'date_of_birth', 'تاريخ الميلاد': 'date_of_birth',
  blood: 'blood_type', 'blood type': 'blood_type', 'groupe sanguin': 'blood_type', 'فصيلة الدم': 'blood_type',
  'file number': 'file_number', 'file no': 'file_number', dossier: 'file_number', 'n° dossier': 'file_number', 'numero dossier': 'file_number', 'رقم الملف': 'file_number',
  address: 'address', adresse: 'address', 'عنوان': 'address',
  wilaya: 'wilaya_code', province: 'wilaya_code', 'ولاية': 'wilaya_code',
  city: 'city', ville: 'city', commune: 'city', 'مدينة': 'city', 'بلدية': 'city',
  notes: 'notes', note: 'notes', remarks: 'notes', remarques: 'notes', 'ملاحظات': 'notes',
  couple: 'is_couple', 'married couple': 'is_couple', marié: 'is_couple',
  'spouse name': 'spouse_name', 'nom conjoint': 'spouse_name', 'اسم الزوج': 'spouse_name',
  'spouse dob': 'spouse_dob', 'date naissance conjoint': 'spouse_dob',
  'spouse blood': 'spouse_blood_type', 'groupe sanguin conjoint': 'spouse_blood_type',
  'spouse gender': 'spouse_gender', 'sexe conjoint': 'spouse_gender',
  'marriage date': 'marriage_date', 'date mariage': 'marriage_date', 'تاريخ الزواج': 'marriage_date',
};

function mapHeader(header: string): keyof ParsedCustomerRow | null {
  const key = header.trim().toLowerCase();
  if (FIELD_ALIASES[key]) return FIELD_ALIASES[key];
  // Fuzzy: strip non-letters
  const stripped = key.replace(/[^a-z\u0600-\u06ff]/g, '');
  for (const [alias, field] of Object.entries(FIELD_ALIASES)) {
    if (alias.replace(/[^a-z\u0600-\u06ff]/g, '') === stripped) return field;
  }
  return null;
}

function normalizeRow(row: Record<string, any>): ParsedCustomerRow {
  const out: ParsedCustomerRow = {};
  for (const [k, v] of Object.entries(row)) {
    const field = mapHeader(k);
    if (!field) continue;
    const str = v == null ? '' : String(v).trim();
    if (!str) continue;
    if (field === 'is_couple') {
      (out as any)[field] = /^(1|true|yes|oui|y|o|نعم)$/i.test(str);
    } else if (field === 'gender' || field === 'spouse_gender') {
      const lc = str.toLowerCase();
      if (/^(m|male|homme|ذكر)$/i.test(lc)) (out as any)[field] = 'male';
      else if (/^(f|female|femme|أنثى)$/i.test(lc)) (out as any)[field] = 'female';
    } else {
      (out as any)[field] = str;
    }
  }
  return out;
}

let xlsxLoader: Promise<any> | null = null;
function loadXlsx(): Promise<any> {
  if ((window as any).XLSX) return Promise.resolve((window as any).XLSX);
  if (xlsxLoader) return xlsxLoader;
  xlsxLoader = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve((window as any).XLSX);
    s.onerror = () => reject(new Error('Failed to load XLSX library'));
    document.head.appendChild(s);
  });
  return xlsxLoader;
}

export async function parseExcelFile(file: File): Promise<ParsedCustomerRow[]> {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[];
  return rows.map(normalizeRow).filter(r => r.phone || r.name);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsvText(text: string): ParsedCustomerRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: ParsedCustomerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const obj: Record<string, any> = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ''; });
    const parsed = normalizeRow(obj);
    if (parsed.phone || parsed.name) rows.push(parsed);
  }
  return rows;
}

/** Converts a Google Sheets share URL to a CSV export URL and fetches rows. */
export async function fetchGoogleSheet(url: string): Promise<ParsedCustomerRow[]> {
  // Extract doc ID
  const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new Error('Invalid Google Sheets URL');
  const docId = idMatch[1];
  const gidMatch = url.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  const csvUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&gid=${gid}`;
  // Use Electron main-process fetch to bypass renderer CORS
  const qf = (window as any).qf;
  let text: string;
  if (qf?.httpFetchText) {
    const result = await qf.httpFetchText(csvUrl);
    if (!result?.ok) {
      throw new Error(`Failed to fetch sheet (${result?.error || 'unknown error'}). Make sure the sheet is shared publicly ("Anyone with the link: Viewer").`);
    }
    text = result.text;
  } else {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`Failed to fetch sheet (HTTP ${res.status}). Make sure the sheet is shared publicly ("Anyone with the link: Viewer").`);
    text = await res.text();
  }
  return parseCsvText(text);
}
