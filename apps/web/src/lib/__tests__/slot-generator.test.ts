import { describe, it, expect, vi } from 'vitest';

// Mock server-only and supabase/admin before importing the module
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { generateTimeSlots } from '../slot-generator';

describe('generateTimeSlots', () => {
  it('generates correct 30-minute slots for a morning schedule', () => {
    const slots = generateTimeSlots('08:00', '12:00', 30);
    expect(slots).toEqual([
      '08:00', '08:30', '09:00', '09:30',
      '10:00', '10:30', '11:00', '11:30',
    ]);
  });

  it('generates correct 60-minute slots', () => {
    const slots = generateTimeSlots('09:00', '12:00', 60);
    expect(slots).toEqual(['09:00', '10:00', '11:00']);
  });

  it('generates correct 15-minute slots', () => {
    const slots = generateTimeSlots('10:00', '11:00', 15);
    expect(slots).toEqual(['10:00', '10:15', '10:30', '10:45']);
  });

  it('does not include the closing time itself', () => {
    const slots = generateTimeSlots('08:00', '09:00', 30);
    expect(slots).toEqual(['08:00', '08:30']);
    expect(slots).not.toContain('09:00');
  });

  it('returns empty array when open equals close', () => {
    const slots = generateTimeSlots('08:00', '08:00', 30);
    expect(slots).toEqual([]);
  });

  it('handles non-aligned durations', () => {
    // 20-minute slots from 08:00 to 09:00 => 08:00, 08:20, 08:40
    const slots = generateTimeSlots('08:00', '09:00', 20);
    expect(slots).toEqual(['08:00', '08:20', '08:40']);
  });

  it('handles crossing hour boundaries', () => {
    const slots = generateTimeSlots('08:45', '10:00', 30);
    expect(slots).toEqual(['08:45', '09:15', '09:45']);
  });

  it('generates a full day of slots', () => {
    const slots = generateTimeSlots('08:00', '17:00', 30);
    expect(slots.length).toBe(18); // 9 hours * 2 slots/hour
    expect(slots[0]).toBe('08:00');
    expect(slots[slots.length - 1]).toBe('16:30');
  });
});
