import { describe, expect, it } from 'vitest';
import {
  canAccessIntakeField,
  filterVisibleIntakeFields,
  maskDisplayName,
  sanitizeCustomerData,
} from './privacy';

describe('privacy helpers', () => {
  it('filters intake fields by scope', () => {
    const fields = [
      { field_name: 'name', visibility: 'public' },
      { field_name: 'symptoms', visibility: 'staff_only' },
      { field_name: 'internal_note', visibility: 'internal' },
    ];

    expect(filterVisibleIntakeFields(fields, 'public').map((field) => field.field_name)).toEqual([
      'name',
      'symptoms',
    ]);
    expect(filterVisibleIntakeFields(fields, 'staff').map((field) => field.field_name)).toEqual([
      'name',
      'symptoms',
    ]);
    expect(filterVisibleIntakeFields(fields, 'admin').map((field) => field.field_name)).toEqual([
      'name',
      'symptoms',
      'internal_note',
    ]);
  });

  it('sanitizes customer data using field visibility', () => {
    const customerData = {
      name: 'Jordan Lee',
      symptoms: 'Migraine',
      internal_note: 'Flagged',
    };
    const fields = [
      { field_name: 'name', visibility: 'public' },
      { field_name: 'symptoms', visibility: 'staff_only' },
      { field_name: 'internal_note', visibility: 'internal' },
    ];

    expect(sanitizeCustomerData(customerData, fields, 'public')).toEqual({
      name: 'Jordan Lee',
      symptoms: 'Migraine',
    });
    expect(sanitizeCustomerData(customerData, fields, 'staff')).toEqual({
      name: 'Jordan Lee',
      symptoms: 'Migraine',
    });
    expect(sanitizeCustomerData(customerData, fields, 'admin')).toEqual(customerData);
  });

  it('masks display names when privacy mode requires it', () => {
    expect(maskDisplayName('Jordan Lee', 'first_name_initial')).toBe('Jordan L.');
    expect(maskDisplayName('Jordan Lee', 'ticket_only')).toBeNull();
    expect(maskDisplayName('Jordan Lee', 'full_name')).toBe('Jordan Lee');
  });

  it('falls back to conservative filtering when field definitions are unavailable', () => {
    expect(
      sanitizeCustomerData(
        {
          name: 'Taylor',
          phone: '+1 555 000 0000',
          reason_for_visit: 'Consultation',
        },
        [],
        'public'
      )
    ).toEqual({
      name: 'Taylor',
    });
  });

  it('normalizes visibility access correctly', () => {
    expect(canAccessIntakeField('public', 'public')).toBe(true);
    expect(canAccessIntakeField('staff_only', 'staff')).toBe(true);
    expect(canAccessIntakeField('internal', 'staff')).toBe(false);
  });
});
