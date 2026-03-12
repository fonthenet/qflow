'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type IntakeField = Database['public']['Tables']['intake_form_fields']['Row'];

interface EditCustomerDataProps {
  ticket: Ticket;
  onUpdated?: (data: Record<string, unknown>) => void;
}

export function EditCustomerData({ ticket, onUpdated }: EditCustomerDataProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [fields, setFields] = useState<IntakeField[]>([]);
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const customerData = (ticket.customer_data ?? {}) as Record<string, string | boolean>;

  const fetchFields = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('intake_form_fields')
      .select('*')
      .eq('service_id', ticket.service_id)
      .order('sort_order', { ascending: true });

    if (data) {
      setFields(data);
      // Initialize with existing customer data
      const initial: Record<string, string | boolean> = {};
      data.forEach((field) => {
        initial[field.field_name] = customerData[field.field_name] ??
          (field.field_type === 'checkbox' ? false : '');
      });
      setFormData(initial);
    }
    setIsLoading(false);
  }, [ticket.service_id, customerData]);

  useEffect(() => {
    if (isOpen && fields.length === 0) {
      fetchFields();
    }
  }, [isOpen, fields.length, fetchFields]);

  const handleChange = (fieldName: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
    if (errors[fieldName]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
    setSaved(false);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    fields.forEach((field) => {
      if (field.is_required) {
        const value = formData[field.field_name];
        if (field.field_type === 'checkbox') {
          if (!value) newErrors[field.field_name] = `${field.field_label} is required`;
        } else if (!value || (typeof value === 'string' && value.trim() === '')) {
          newErrors[field.field_name] = `${field.field_label} is required`;
        }
      }
      if (field.field_type === 'email' && formData[field.field_name]) {
        const v = formData[field.field_name] as string;
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
          newErrors[field.field_name] = 'Please enter a valid email';
        }
      }
      if (field.field_type === 'phone' && formData[field.field_name]) {
        const v = formData[field.field_name] as string;
        if (v && !/^[+]?[\d\s\-()]{7,}$/.test(v)) {
          newErrors[field.field_name] = 'Please enter a valid phone number';
        }
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setIsSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('tickets')
        .update({
          customer_data: formData as unknown as Database['public']['Tables']['tickets']['Update']['customer_data'],
        })
        .eq('id', ticket.id);

      if (error) throw error;
      setSaved(true);
      onUpdated?.(formData);
      setTimeout(() => setIsOpen(false), 1000);
    } catch {
      setErrors({ _form: 'Failed to save. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const hasData = Object.values(customerData).some((v) => v !== '' && v !== false);

  const renderField = (field: IntakeField) => {
    const hasError = !!errors[field.field_name];
    const baseClass = `w-full rounded-lg border px-3 py-2.5 text-sm transition-colors outline-none ${
      hasError
        ? 'border-destructive bg-destructive/5'
        : 'border-input bg-background focus:border-primary focus:ring-1 focus:ring-primary'
    }`;

    switch (field.field_type) {
      case 'textarea':
        return <textarea id={field.field_name} rows={2} className={`${baseClass} resize-none`} value={(formData[field.field_name] as string) ?? ''} onChange={(e) => handleChange(field.field_name, e.target.value)} />;
      case 'select': {
        const options = (field.options as string[]) ?? [];
        return (
          <select id={field.field_name} className={baseClass} value={(formData[field.field_name] as string) ?? ''} onChange={(e) => handleChange(field.field_name, e.target.value)}>
            <option value="">Select...</option>
            {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      }
      case 'checkbox':
        return (
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 rounded accent-primary" checked={!!formData[field.field_name]} onChange={(e) => handleChange(field.field_name, e.target.checked)} />
            <span className="text-sm">{field.field_label}</span>
          </label>
        );
      case 'date':
        return <input type="date" id={field.field_name} className={baseClass} value={(formData[field.field_name] as string) ?? ''} onChange={(e) => handleChange(field.field_name, e.target.value)} />;
      case 'email':
        return <input type="email" id={field.field_name} className={baseClass} value={(formData[field.field_name] as string) ?? ''} onChange={(e) => handleChange(field.field_name, e.target.value)} placeholder="email@example.com" />;
      case 'phone':
        return <input type="tel" id={field.field_name} className={baseClass} value={(formData[field.field_name] as string) ?? ''} onChange={(e) => handleChange(field.field_name, e.target.value)} placeholder="07 123 456 78" />;
      default:
        return <input type="text" id={field.field_name} className={baseClass} value={(formData[field.field_name] as string) ?? ''} onChange={(e) => handleChange(field.field_name, e.target.value)} />;
    }
  };

  return (
    <div className="rounded-xl bg-card shadow-sm">
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="text-sm font-medium text-foreground">My Information</span>
          {hasData && !isOpen && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Filled</span>
          )}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable form */}
      {isOpen && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : fields.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No additional information needed for this service.
            </p>
          ) : (
            <div className="space-y-3">
              {fields.map((field) => (
                <div key={field.id}>
                  {field.field_type !== 'checkbox' && (
                    <label htmlFor={field.field_name} className="mb-1 block text-xs font-medium text-muted-foreground">
                      {field.field_label}
                      {field.is_required && <span className="ml-0.5 text-destructive">*</span>}
                    </label>
                  )}
                  {renderField(field)}
                  {errors[field.field_name] && (
                    <p className="mt-1 text-xs text-destructive">{errors[field.field_name]}</p>
                  )}
                </div>
              ))}

              {errors._form && (
                <p className="text-xs text-destructive">{errors._form}</p>
              )}

              <button
                onClick={handleSave}
                disabled={isSaving}
                className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  saved
                    ? 'bg-green-600 text-white'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                } disabled:opacity-60`}
              >
                {isSaving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving...
                  </span>
                ) : saved ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Saved!
                  </span>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
