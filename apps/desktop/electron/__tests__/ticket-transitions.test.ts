import { describe, it, expect } from 'vitest';
import { isValidTransition, isTerminalStatus, VALID_TRANSITIONS } from '../ticket-transitions';

describe('isValidTransition', () => {
  // ── Valid transitions ──────────────────────────────────────────────

  describe('issued →', () => {
    it('allows issued → waiting', () => expect(isValidTransition('issued', 'waiting')).toBe(true));
    it('allows issued → cancelled', () => expect(isValidTransition('issued', 'cancelled')).toBe(true));
    it('rejects issued → called', () => expect(isValidTransition('issued', 'called')).toBe(false));
    it('rejects issued → serving', () => expect(isValidTransition('issued', 'serving')).toBe(false));
    it('rejects issued → served', () => expect(isValidTransition('issued', 'served')).toBe(false));
    it('rejects issued → no_show', () => expect(isValidTransition('issued', 'no_show')).toBe(false));
    it('rejects issued → transferred', () => expect(isValidTransition('issued', 'transferred')).toBe(false));
  });

  describe('pending_approval →', () => {
    it('allows pending_approval → waiting', () => expect(isValidTransition('pending_approval', 'waiting')).toBe(true));
    it('allows pending_approval → cancelled', () => expect(isValidTransition('pending_approval', 'cancelled')).toBe(true));
    it('rejects pending_approval → called', () => expect(isValidTransition('pending_approval', 'called')).toBe(false));
    it('rejects pending_approval → served', () => expect(isValidTransition('pending_approval', 'served')).toBe(false));
    it('rejects pending_approval → serving', () => expect(isValidTransition('pending_approval', 'serving')).toBe(false));
    it('rejects pending_approval → no_show', () => expect(isValidTransition('pending_approval', 'no_show')).toBe(false));
  });

  describe('waiting →', () => {
    it('allows waiting → called', () => expect(isValidTransition('waiting', 'called')).toBe(true));
    it('allows waiting → cancelled', () => expect(isValidTransition('waiting', 'cancelled')).toBe(true));
    it('allows waiting → no_show', () => expect(isValidTransition('waiting', 'no_show')).toBe(true));
    it('allows waiting → transferred', () => expect(isValidTransition('waiting', 'transferred')).toBe(true));
    it('rejects waiting → serving', () => expect(isValidTransition('waiting', 'serving')).toBe(false));
    it('rejects waiting → served', () => expect(isValidTransition('waiting', 'served')).toBe(false));
    it('rejects waiting → issued', () => expect(isValidTransition('waiting', 'issued')).toBe(false));
    it('rejects waiting → pending_approval', () => expect(isValidTransition('waiting', 'pending_approval')).toBe(false));
  });

  describe('called →', () => {
    it('allows called → serving', () => expect(isValidTransition('called', 'serving')).toBe(true));
    it('allows called → waiting (re-queue)', () => expect(isValidTransition('called', 'waiting')).toBe(true));
    it('allows called → cancelled', () => expect(isValidTransition('called', 'cancelled')).toBe(true));
    it('allows called → no_show', () => expect(isValidTransition('called', 'no_show')).toBe(true));
    it('rejects called → served', () => expect(isValidTransition('called', 'served')).toBe(false));
    it('rejects called → issued', () => expect(isValidTransition('called', 'issued')).toBe(false));
    it('rejects called → transferred', () => expect(isValidTransition('called', 'transferred')).toBe(false));
  });

  describe('serving →', () => {
    it('allows serving → served', () => expect(isValidTransition('serving', 'served')).toBe(true));
    it('allows serving → waiting (re-queue)', () => expect(isValidTransition('serving', 'waiting')).toBe(true));
    it('allows serving → cancelled', () => expect(isValidTransition('serving', 'cancelled')).toBe(true));
    it('allows serving → no_show', () => expect(isValidTransition('serving', 'no_show')).toBe(true));
    it('rejects serving → called', () => expect(isValidTransition('serving', 'called')).toBe(false));
    it('rejects serving → issued', () => expect(isValidTransition('serving', 'issued')).toBe(false));
    it('rejects serving → transferred', () => expect(isValidTransition('serving', 'transferred')).toBe(false));
  });

  describe('transferred →', () => {
    it('allows transferred → waiting', () => expect(isValidTransition('transferred', 'waiting')).toBe(true));
    it('allows transferred → cancelled', () => expect(isValidTransition('transferred', 'cancelled')).toBe(true));
    it('rejects transferred → called', () => expect(isValidTransition('transferred', 'called')).toBe(false));
    it('rejects transferred → serving', () => expect(isValidTransition('transferred', 'serving')).toBe(false));
    it('rejects transferred → served', () => expect(isValidTransition('transferred', 'served')).toBe(false));
    it('rejects transferred → issued', () => expect(isValidTransition('transferred', 'issued')).toBe(false));
  });

  // ── Terminal states ────────────────────────────────────────────────

  describe('terminal states have no outgoing transitions', () => {
    const terminalStatuses = ['served', 'cancelled', 'no_show'];
    const allStatuses = Object.keys(VALID_TRANSITIONS);

    for (const terminal of terminalStatuses) {
      for (const target of allStatuses) {
        it(`rejects ${terminal} → ${target}`, () => {
          expect(isValidTransition(terminal, target)).toBe(false);
        });
      }
    }
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns false for unknown source status', () => {
      expect(isValidTransition('nonexistent', 'waiting')).toBe(false);
    });

    it('returns false for unknown target status', () => {
      expect(isValidTransition('waiting', 'nonexistent')).toBe(false);
    });

    it('returns false for same-to-same transition', () => {
      expect(isValidTransition('waiting', 'waiting')).toBe(false);
      expect(isValidTransition('called', 'called')).toBe(false);
      expect(isValidTransition('served', 'served')).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(isValidTransition('', '')).toBe(false);
      expect(isValidTransition('', 'waiting')).toBe(false);
      expect(isValidTransition('waiting', '')).toBe(false);
    });

    it('returns false for undefined-like values cast to string', () => {
      expect(isValidTransition('undefined', 'waiting')).toBe(false);
      expect(isValidTransition('null', 'waiting')).toBe(false);
    });
  });

  // ── Exhaustive: every declared transition is valid ─────────────────

  describe('all declared transitions are valid', () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        it(`${from} → ${to}`, () => {
          expect(isValidTransition(from, to)).toBe(true);
        });
      }
    }
  });

  // ── VALID_TRANSITIONS structure checks ─────────────────────────────

  describe('VALID_TRANSITIONS structure', () => {
    it('contains all expected statuses as keys', () => {
      const expected = ['issued', 'pending_approval', 'waiting', 'called', 'serving', 'served', 'cancelled', 'no_show', 'transferred'];
      for (const status of expected) {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
      }
    });

    it('terminal states have empty transition arrays', () => {
      expect(VALID_TRANSITIONS['served']).toHaveLength(0);
      expect(VALID_TRANSITIONS['cancelled']).toHaveLength(0);
      expect(VALID_TRANSITIONS['no_show']).toHaveLength(0);
    });

    it('non-terminal states have at least one transition', () => {
      const nonTerminal = ['issued', 'pending_approval', 'waiting', 'called', 'serving', 'transferred'];
      for (const status of nonTerminal) {
        expect(VALID_TRANSITIONS[status].length).toBeGreaterThan(0);
      }
    });
  });
});

describe('isTerminalStatus', () => {
  it('returns true for served', () => expect(isTerminalStatus('served')).toBe(true));
  it('returns true for cancelled', () => expect(isTerminalStatus('cancelled')).toBe(true));
  it('returns true for no_show', () => expect(isTerminalStatus('no_show')).toBe(true));

  it('returns false for waiting', () => expect(isTerminalStatus('waiting')).toBe(false));
  it('returns false for called', () => expect(isTerminalStatus('called')).toBe(false));
  it('returns false for serving', () => expect(isTerminalStatus('serving')).toBe(false));
  it('returns false for issued', () => expect(isTerminalStatus('issued')).toBe(false));
  it('returns false for pending_approval', () => expect(isTerminalStatus('pending_approval')).toBe(false));
  it('returns false for transferred', () => expect(isTerminalStatus('transferred')).toBe(false));

  it('returns false for empty string', () => expect(isTerminalStatus('')).toBe(false));
  it('returns false for unknown status', () => expect(isTerminalStatus('unknown')).toBe(false));
  it('returns false for undefined-like string', () => expect(isTerminalStatus('undefined')).toBe(false));

  it('is consistent with VALID_TRANSITIONS (terminal = empty array)', () => {
    for (const [status, targets] of Object.entries(VALID_TRANSITIONS)) {
      if (targets.length === 0) {
        expect(isTerminalStatus(status)).toBe(true);
      } else {
        expect(isTerminalStatus(status)).toBe(false);
      }
    }
  });
});
