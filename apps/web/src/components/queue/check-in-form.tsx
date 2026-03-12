'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type IntakeField = Database['public']['Tables']['intake_form_fields']['Row'];

interface CheckInFormProps {
  ticket: Ticket;
  officeName: string;
  serviceName: string;
}

export function CheckInForm({ ticket, officeName, serviceName }: CheckInFormProps) {
  const router = useRouter();
  const [fields, setFields] = useState<IntakeField[]>([]);
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('intake_form_fields')
      .select('*')
      .eq('service_id', ticket.service_id)
      .order('sort_order', { ascending: true });

    if (data && data.length > 0) {
      setFields(data);
      // Initialize form data with empty values
      const initial: Record<string, string | boolean> = {};
      data.forEach((field) => {
        initial[field.field_name] = field.field_type === 'checkbox' ? false : '';
      });
      setFormData(initial);
    }
    setIsLoading(false);
  }, [ticket.service_id]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    fields.forEach((field) => {
      if (field.is_required) {
        const value = formData[field.field_name];
        if (field.field_type === 'checkbox') {
          if (!value) {
            newErrors[field.field_name] = `${field.field_label} is required`;
          }
        } else if (!value || (typeof value === 'string' && value.trim() === '')) {
          newErrors[field.field_name] = `${field.field_label} is required`;
        }
      }

      // Email validation
      if (field.field_type === 'email' && formData[field.field_name]) {
        const emailValue = formData[field.field_name] as string;
        if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
          newErrors[field.field_name] = 'Please enter a valid email';
        }
      }

      // Phone validation
      if (field.field_type === 'phone' && formData[field.field_name]) {
        const phoneValue = formData[field.field_name] as string;
        if (phoneValue && !/^[+]?[\d\s\-()]{7,}$/.test(phoneValue)) {
          newErrors[field.field_name] = 'Please enter a valid phone number';
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('tickets')
        .update({
          customer_data: formData as unknown as Database['public']['Tables']['tickets']['Update']['customer_data'],
          status: 'waiting',
          checked_in_at: new Date().toISOString(),
        })
        .eq('id', ticket.id);

      if (error) throw error;

      router.refresh();
    } catch {
      setSubmitError('Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (fieldName: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
    // Clear error on change
    if (errors[fieldName]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  const renderField = (field: IntakeField) => {
    const hasError = !!errors[field.field_name];
    const baseInputClass = `w-full rounded-lg border px-4 py-3 text-base transition-colors outline-none ${
      hasError
        ? 'border-destructive bg-destructive/5 focus:ring-2 focus:ring-destructive/20'
        : 'border-input bg-card focus:border-primary focus:ring-2 focus:ring-primary/20'
    }`;

    switch (field.field_type) {
      case 'textarea':
        return (
          <textarea
            id={field.field_name}
            rows={3}
            className={`${baseInputClass} resize-none`}
            value={(formData[field.field_name] as string) ?? ''}
            onChange={(e) => handleChange(field.field_name, e.target.value)}
            placeholder={`Enter ${field.field_label.toLowerCase()}`}
          />
        );

      case 'select': {
        const options = (field.options as string[]) ?? [];
        return (
          <select
            id={field.field_name}
            className={baseInputClass}
            value={(formData[field.field_name] as string) ?? ''}
            onChange={(e) => handleChange(field.field_name, e.target.value)}
          >
            <option value="">Select {field.field_label.toLowerCase()}</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      }

      case 'checkbox':
        return (
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-input accent-primary"
              checked={!!formData[field.field_name]}
              onChange={(e) => handleChange(field.field_name, e.target.checked)}
            />
            <span className="text-base text-foreground">{field.field_label}</span>
          </label>
        );

      case 'date':
        return (
          <input
            type="date"
            id={field.field_name}
            className={baseInputClass}
            value={(formData[field.field_name] as string) ?? ''}
            onChange={(e) => handleChange(field.field_name, e.target.value)}
          />
        );

      case 'email':
        return (
          <input
            type="email"
            id={field.field_name}
            className={baseInputClass}
            value={(formData[field.field_name] as string) ?? ''}
            onChange={(e) => handleChange(field.field_name, e.target.value)}
            placeholder="email@example.com"
            autoComplete="email"
          />
        );

      case 'phone':
        return (
          <input
            type="tel"
            id={field.field_name}
            className={baseInputClass}
            value={(formData[field.field_name] as string) ?? ''}
            onChange={(e) => handleChange(field.field_name, e.target.value)}
            placeholder="+1 (555) 000-0000"
            autoComplete="tel"
          />
        );

      default:
        return (
          <input
            type="text"
            id={field.field_name}
            className={baseInputClass}
            value={(formData[field.field_name] as string) ?? ''}
            onChange={(e) => handleChange(field.field_name, e.target.value)}
            placeholder={`Enter ${field.field_label.toLowerCase()}`}
          />
        );
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      {/* Header */}
      <div className="bg-primary px-4 pb-8 pt-6 text-primary-foreground">
        <div className="mx-auto max-w-sm">
          <p className="mb-1 text-sm font-medium opacity-80">{officeName}</p>
          <h1 className="text-xl font-bold">{serviceName}</h1>
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-white/15 px-4 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
              #
            </div>
            <div>
              <p className="text-xs opacity-80">Your Ticket</p>
              <p className="text-2xl font-bold tracking-wide">{ticket.ticket_number}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-6">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Check In</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Please fill in your details to join the queue.
        </p>

        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Loading form...</p>
          </div>
        ) : fields.length === 0 ? (
          // No intake fields configured - just submit to move to waiting
          <form onSubmit={handleSubmit}>
            <p className="mb-6 text-sm text-muted-foreground">
              No additional information is needed. Tap the button below to join the queue.
            </p>
            {submitError && (
              <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {submitError}
              </div>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Joining Queue...
                </span>
              ) : (
                'Join Queue'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {fields.map((field) => (
              <div key={field.id}>
                {field.field_type !== 'checkbox' && (
                  <label
                    htmlFor={field.field_name}
                    className="mb-1.5 block text-sm font-medium text-foreground"
                  >
                    {field.field_label}
                    {field.is_required && (
                      <span className="ml-1 text-destructive">*</span>
                    )}
                  </label>
                )}
                {renderField(field)}
                {errors[field.field_name] && (
                  <p className="mt-1.5 text-xs text-destructive">{errors[field.field_name]}</p>
                )}
              </div>
            ))}

            {submitError && (
              <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Joining Queue...
                </span>
              ) : (
                'Join Queue'
              )}
            </button>
          </form>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 pt-2 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by QueueFlow
        </p>
      </div>
    </div>
  );
}
