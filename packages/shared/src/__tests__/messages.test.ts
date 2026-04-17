import { describe, it, expect } from 'vitest';
import { notificationMessages, renderNotification, type Locale } from '../messages';

describe('notificationMessages', () => {
  const requiredKeys = [
    'called', 'recall', 'buzz', 'serving', 'served', 'no_show',
    'next_in_line', 'approaching', 'joined', 'cancelled_notify',
    'position_update', 'default',
  ];
  const locales: Locale[] = ['fr', 'ar', 'en'];

  it('has all required template keys', () => {
    for (const key of requiredKeys) {
      expect(notificationMessages[key]).toBeDefined();
    }
  });

  it('has all three locales for each key', () => {
    for (const key of requiredKeys) {
      for (const locale of locales) {
        expect(notificationMessages[key][locale]).toBeDefined();
        expect(notificationMessages[key][locale].length).toBeGreaterThan(0);
      }
    }
  });

  it('called template includes {ticket} and {desk} placeholders', () => {
    expect(notificationMessages.called.en).toContain('{ticket}');
    expect(notificationMessages.called.en).toContain('{desk}');
    expect(notificationMessages.called.en).toContain('{name}');
  });

  it('joined template includes {position} placeholder', () => {
    expect(notificationMessages.joined.en).toContain('{position}');
    expect(notificationMessages.joined.en).toContain('{ticket}');
  });
});

describe('renderNotification', () => {
  it('substitutes variables', () => {
    const result = renderNotification('served', 'en', {
      ticket: 'HAD-0125',
      name: 'Hadabi Clinic',
    });
    expect(result).toContain('HAD-0125');
    expect(result).toContain('Hadabi Clinic');
    expect(result).toContain('complete');
  });

  it('renders called template with all vars', () => {
    const result = renderNotification('called', 'fr', {
      name: 'Test Org',
      ticket: 'TST-0001',
      desk: 'Guichet 3',
      wait: '5',
      url: 'https://qflo.net/q/abc',
    });
    expect(result).toContain('Test Org');
    expect(result).toContain('TST-0001');
    expect(result).toContain('Guichet 3');
    expect(result).toContain('5 minutes');
    expect(result).toContain('https://qflo.net/q/abc');
  });

  it('falls back to French if locale missing', () => {
    const result = renderNotification('served', 'fr', { ticket: 'X', name: 'Y' });
    expect(result).toContain('terminé');
  });

  it('falls back to key if template not found', () => {
    const result = renderNotification('nonexistent_key', 'en');
    expect(result).toBe('nonexistent_key');
  });

  it('handles position_update template', () => {
    const result = renderNotification('position_update', 'en', {
      name: 'Clinic',
      position: '3',
      wait: '10',
      url: 'https://example.com',
    });
    expect(result).toContain('#3');
    expect(result).toContain('10 min');
  });

  // ── Regression: broken WhatsApp bold markers when vars are empty ──
  // Bug case: served template "Ticket *{ticket}* at *{name}* is complete..."
  // with empty orgName produced "Ticket *S-0010* at * is complete" because
  // WhatsApp can't render `**` as bold and leaks the raw stars.
  describe('sanitization (empty variable handling)', () => {
    it('never produces empty bold pairs when name is empty string', () => {
      const out = renderNotification('served', 'en', {
        ticket: 'S-0010', name: '', date: '17/04/2026', time: '03:36',
      });
      expect(out).not.toMatch(/\*\s*\*/);
      // No orphan star immediately followed by a non-asterisk non-wordchar
      // (a healthy "at *03:36*" is fine — that's a legit bold closing).
      expect(out).not.toMatch(/\bat\s*\*\s/);
    });

    it('never produces empty bold pairs when name is null', () => {
      const out = renderNotification('served', 'fr', {
        ticket: 'S-0010', name: null, date: '17/04/2026', time: '03:36',
      });
      expect(out).not.toMatch(/\*\s*\*/);
    });

    it('never produces empty bold pairs when name is undefined', () => {
      const out = renderNotification('served', 'ar', {
        ticket: 'S-0010', name: undefined, date: '17/04/2026', time: '03:36',
      });
      expect(out).not.toMatch(/\*\s*\*/);
    });

    it('drops trailing "at" when the venue name is missing (EN)', () => {
      const out = renderNotification('served', 'en', {
        ticket: 'S-0010', name: '', date: '17/04/2026', time: '03:36',
      });
      // Should NOT contain dangling "at" right before punctuation
      expect(out).not.toMatch(/\bat\s*[.,!?]/);
    });

    it('produces clean output when all named vars are empty', () => {
      const out = renderNotification('served', 'en', {
        ticket: '', name: '', date: '', time: '',
      });
      // Should have no stars, no empty parens, no doubled spaces
      expect(out).not.toMatch(/\*\s*\*/);
      expect(out).not.toMatch(/\(\s*\)/);
      expect(out).not.toMatch(/ {2,}/);
    });

    it('preserves bold formatting when values ARE present', () => {
      const out = renderNotification('served', 'en', {
        ticket: 'S-0010', name: 'Acme Clinic', date: '17/04/2026', time: '03:36',
      });
      expect(out).toContain('*S-0010*');
      expect(out).toContain('*Acme Clinic*');
      expect(out).toContain('*17/04/2026*');
    });

    it('called template stays clean when desk is missing', () => {
      const out = renderNotification('called', 'en', {
        name: 'Acme', ticket: 'A-1', desk: '', wait: '5', url: 'https://x',
      });
      expect(out).not.toMatch(/\*\s*\*/);
    });
  });
});
