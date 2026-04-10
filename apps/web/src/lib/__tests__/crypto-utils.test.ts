import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeCompare, authenticateServiceRequest } from '../crypto-utils';

describe('safeCompare', () => {
  it('returns true for matching strings', () => {
    expect(safeCompare('hello', 'hello')).toBe(true);
    expect(safeCompare('abc123', 'abc123')).toBe(true);
  });

  it('returns false for non-matching strings', () => {
    expect(safeCompare('hello', 'world')).toBe(false);
    expect(safeCompare('abc', 'def')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(safeCompare('', '')).toBe(false);
    expect(safeCompare('', 'hello')).toBe(false);
    expect(safeCompare('hello', '')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(safeCompare('short', 'a much longer string')).toBe(false);
    expect(safeCompare('abc', 'ab')).toBe(false);
  });
});

describe('authenticateServiceRequest', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns false for null auth header', () => {
    expect(authenticateServiceRequest(null)).toBe(false);
  });

  it('returns false for non-Bearer header', () => {
    expect(authenticateServiceRequest('Basic abc123')).toBe(false);
  });

  it('returns false for empty Bearer token', () => {
    expect(authenticateServiceRequest('Bearer ')).toBe(false);
  });

  it('returns true when token matches SUPABASE_SERVICE_ROLE_KEY', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'my-service-key');
    vi.stubEnv('INTERNAL_WEBHOOK_SECRET', '');
    expect(authenticateServiceRequest('Bearer my-service-key')).toBe(true);
  });

  it('returns true when token matches INTERNAL_WEBHOOK_SECRET', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('INTERNAL_WEBHOOK_SECRET', 'my-webhook-secret');
    expect(authenticateServiceRequest('Bearer my-webhook-secret')).toBe(true);
  });

  it('returns false when token matches neither secret', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'key-a');
    vi.stubEnv('INTERNAL_WEBHOOK_SECRET', 'key-b');
    expect(authenticateServiceRequest('Bearer wrong-key')).toBe(false);
  });
});
