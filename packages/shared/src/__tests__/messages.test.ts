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

  it('replaces missing vars with ?', () => {
    const result = renderNotification('served', 'en', { ticket: null as any });
    expect(result).toContain('?');
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
});
