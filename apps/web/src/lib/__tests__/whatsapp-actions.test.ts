/**
 * Tests for apps/web/src/lib/actions/whatsapp-actions.ts
 *
 * Cases:
 *  1. Happy path: valid admin saves credentials — encrypt is called, rpc is called, returns ok:true.
 *  2. Unauthorized caller: non-admin is rejected before any DB call.
 *  3. Input validation: blank fields return errors without hitting DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock 'server-only' so modules that import it don't blow up in test env
vi.mock('server-only', () => ({}));

// Mock crypto.ts — must not be a hoisted variable reference
vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn().mockResolvedValue('iv.ciphertext'),
  decrypt: vi.fn().mockResolvedValue('plain-token'),
}));

// Mock audit logger — always resolves silently
vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock authz — factory uses inline vi.fn() so no hoisting issue
vi.mock('@/lib/authz', () => ({
  getStaffContext: vi.fn().mockResolvedValue({
    supabase: { rpc: vi.fn().mockResolvedValue({ error: null }) },
    userId: 'user-1',
    staff: {
      id: 'staff-1',
      organization_id: 'org-1',
      role: 'admin',
      full_name: 'Test Admin',
      email: 'admin@test.com',
      office_id: null,
      department_id: null,
    },
    accessibleOfficeIds: [],
  }),
  requireOrganizationAdmin: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { saveWhatsAppCredentials } from '@/lib/actions/whatsapp-actions';
import { encrypt } from '@/lib/crypto';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';

// ── Suite 1: Happy path ────────────────────────────────────────────────────

describe('saveWhatsAppCredentials — happy path', () => {
  let mockRpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getStaffContext).mockResolvedValue({
      supabase: { rpc: mockRpc } as never,
      userId: 'user-1',
      staff: {
        id: 'staff-1',
        organization_id: 'org-1',
        role: 'admin',
        full_name: 'Test Admin',
        email: 'admin@test.com',
        office_id: null,
        department_id: null,
      },
      accessibleOfficeIds: [],
    });
    vi.mocked(requireOrganizationAdmin).mockResolvedValue(undefined);
    vi.mocked(encrypt).mockResolvedValue('iv.ciphertext');
  });

  it('encrypts the access token and calls upsert_org_whatsapp_credentials', async () => {
    const result = await saveWhatsAppCredentials({
      phone_number_id: '12345678',
      access_token: 'my-secret-token',
      business_account_id: 'waba-99',
      verify_token: 'abc123def456abc1',
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();

    // encrypt must be called with the plaintext token
    expect(encrypt).toHaveBeenCalledWith('my-secret-token');

    // rpc must be called with the encrypted value, never the plaintext
    expect(mockRpc).toHaveBeenCalledWith('upsert_org_whatsapp_credentials', {
      p_org_id: 'org-1',
      p_phone_number_id: '12345678',
      p_access_token_encrypted: 'iv.ciphertext',
      p_business_account_id: 'waba-99',
      p_verify_token: 'abc123def456abc1',
    });
  });

  it('returns generic error when rpc fails — never exposes db message', async () => {
    mockRpc.mockResolvedValue({ error: { code: 'P0001', message: 'internal db error' } });

    const result = await saveWhatsAppCredentials({
      phone_number_id: '12345678',
      access_token: 'my-secret-token',
      business_account_id: 'waba-99',
      verify_token: 'abc123def456abc1',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    // Must NOT expose the raw DB error message
    expect(result.error).not.toContain('internal db error');
  });
});

// ── Suite 2: Unauthorized ─────────────────────────────────────────────────

describe('saveWhatsAppCredentials — unauthorized caller', () => {
  let mockRpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getStaffContext).mockResolvedValue({
      supabase: { rpc: mockRpc } as never,
      userId: 'user-1',
      staff: {
        id: 'staff-1',
        organization_id: 'org-1',
        role: 'receptionist',
        full_name: 'Desk Operator',
        email: 'desk@test.com',
        office_id: 'office-1',
        department_id: null,
      },
      accessibleOfficeIds: ['office-1'],
    });
  });

  it('rejects when requireOrganizationAdmin throws', async () => {
    vi.mocked(requireOrganizationAdmin).mockRejectedValueOnce(
      new Error('You do not have permission to perform this action'),
    );

    const result = await saveWhatsAppCredentials({
      phone_number_id: '12345678',
      access_token: 'my-secret-token',
      business_account_id: 'waba-99',
      verify_token: 'abc123def456abc1',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
  });

  it('rejects when getStaffContext throws (unauthenticated session)', async () => {
    vi.mocked(getStaffContext).mockRejectedValueOnce(new Error('Not authenticated'));

    const result = await saveWhatsAppCredentials({
      phone_number_id: '12345678',
      access_token: 'my-secret-token',
      business_account_id: 'waba-99',
      verify_token: 'abc123def456abc1',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ── Suite 3: Input validation ─────────────────────────────────────────────

describe('saveWhatsAppCredentials — input validation', () => {
  let mockRpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getStaffContext).mockResolvedValue({
      supabase: { rpc: mockRpc } as never,
      userId: 'user-1',
      staff: {
        id: 'staff-1',
        organization_id: 'org-1',
        role: 'admin',
        full_name: 'Test Admin',
        email: 'admin@test.com',
        office_id: null,
        department_id: null,
      },
      accessibleOfficeIds: [],
    });
    vi.mocked(requireOrganizationAdmin).mockResolvedValue(undefined);
  });

  it('returns error when access_token is blank whitespace', async () => {
    const result = await saveWhatsAppCredentials({
      phone_number_id: '12345678',
      access_token: '   ',
      business_account_id: 'waba-99',
      verify_token: 'abc123def456abc1',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns error when phone_number_id is empty', async () => {
    const result = await saveWhatsAppCredentials({
      phone_number_id: '',
      access_token: 'valid-token',
      business_account_id: 'waba-99',
      verify_token: 'abc123',
    });

    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns error when verify_token is empty', async () => {
    const result = await saveWhatsAppCredentials({
      phone_number_id: '12345678',
      access_token: 'valid-token',
      business_account_id: 'waba-99',
      verify_token: '',
    });

    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
