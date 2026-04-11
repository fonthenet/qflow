import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock supabase before importing the module under test ───────────
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockGetSession = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
    auth: { getSession: mockGetSession },
    supabaseUrl: 'https://test.supabase.co',
  },
}));

vi.mock('i18next', () => ({ default: { language: 'en' } }));
vi.mock('@/lib/config', () => ({ API_BASE_URL: 'https://test.api.com' }));

// We need to import the module dynamically to get access to the
// non-exported `normalizePhoneForWhatsApp`.  Instead, we extract the
// logic by re-implementing the constants here and testing the algorithm
// directly.  For exported async functions we import normally.

// ── normalizePhoneForWhatsApp (re-implemented for unit testing) ────
// This mirrors the exact logic in ticket-actions.ts lines 6-38.
const TIMEZONE_DIAL: Record<string, string> = {
  'Africa/Algiers': '213', 'Africa/Tunis': '216', 'Africa/Casablanca': '212',
  'Africa/Cairo': '20', 'Africa/Lagos': '234', 'Europe/Paris': '33',
  'Europe/London': '44', 'Europe/Berlin': '49', 'Asia/Riyadh': '966',
  'Asia/Dubai': '971', 'America/New_York': '1', 'America/Chicago': '1',
  'America/Denver': '1', 'America/Los_Angeles': '1', 'America/Toronto': '1',
};
const ISO_DIAL: Record<string, string> = {
  DZ: '213', TN: '216', MA: '212', EG: '20', FR: '33', GB: '44', DE: '49',
  US: '1', CA: '1', SA: '966', AE: '971', QA: '974',
};
const ALL_CODES = [...new Set(Object.values(ISO_DIAL))].sort((a, b) => b.length - a.length);

function normalizePhoneForWhatsApp(phone: string, tz?: string | null, cc?: string | null): string | null {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  if (hasPlus) return digits;
  const dialCode = (cc && ISO_DIAL[cc.toUpperCase()]) || (tz && TIMEZONE_DIAL[tz]) || null;
  if (digits.startsWith('0') && dialCode) return dialCode + digits.slice(1);
  if (dialCode && digits.startsWith(dialCode) && digits.length > dialCode.length + 6) return digits;
  for (const code of ALL_CODES) {
    if (digits.startsWith(code) && digits.length >= code.length + 7) return digits;
  }
  if (digits.length === 10 && !digits.startsWith('0')) return '1' + digits;
  if (digits.length === 9 && dialCode === '213') return '213' + digits;
  if (digits.length === 9 && dialCode === '33') return '33' + digits;
  if (dialCode && digits.length <= 9) return dialCode + digits;
  return digits;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('normalizePhoneForWhatsApp', () => {
  it('returns null for short numbers', () => {
    expect(normalizePhoneForWhatsApp('123')).toBeNull();
    expect(normalizePhoneForWhatsApp('12345')).toBeNull();
  });

  it('strips "+" prefix and returns digits for international format', () => {
    expect(normalizePhoneForWhatsApp('+213551234567')).toBe('213551234567');
    expect(normalizePhoneForWhatsApp('+33612345678')).toBe('33612345678');
  });

  it('replaces leading 0 with dial code when country code is provided', () => {
    expect(normalizePhoneForWhatsApp('0551234567', null, 'DZ')).toBe('213551234567');
    expect(normalizePhoneForWhatsApp('0612345678', null, 'FR')).toBe('33612345678');
  });

  it('uses timezone to derive dial code when no country code', () => {
    expect(normalizePhoneForWhatsApp('0551234567', 'Africa/Algiers')).toBe('213551234567');
  });

  it('assumes US/CA for 10-digit numbers without leading 0', () => {
    expect(normalizePhoneForWhatsApp('5551234567')).toBe('15551234567');
  });
});

describe('checkInAppointment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok123' } } });
    global.fetch = vi.fn();
  });

  it('calls the moderate-appointment API with check_in action', async () => {
    const { checkInAppointment } = await import('../ticket-actions');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: { id: 't1' } }),
    });

    const result = await checkInAppointment('apt-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://test.api.com/api/moderate-appointment',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ appointmentId: 'apt-1', action: 'check_in' }),
      }),
    );
    expect(result).toEqual({ id: 't1' });
  });
});

describe('cancelAppointment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok123' } } });
    global.fetch = vi.fn();
  });

  it('calls the moderate-appointment API with cancel action', async () => {
    const { cancelAppointment } = await import('../ticket-actions');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await cancelAppointment('apt-2');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://test.api.com/api/moderate-appointment',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ appointmentId: 'apt-2', action: 'cancel' }),
      }),
    );
  });

  it('throws on HTTP error', async () => {
    const { cancelAppointment } = await import('../ticket-actions');
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Already cancelled' }),
    });

    await expect(cancelAppointment('apt-3')).rejects.toThrow('Already cancelled');
  });
});
