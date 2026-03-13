'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, MessageSquare, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  extractTicketPhone,
  formatPriorityAlertEvents,
  getEnabledPriorityAlertEvents,
  normalizePhoneNumber,
  type PriorityAlertConfig,
} from '@/lib/priority-alerts';
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];

interface PriorityAlertSetupProps {
  ticket: Ticket;
  config: PriorityAlertConfig | null | undefined;
}

export function PriorityAlertSetup({
  ticket,
  config,
}: PriorityAlertSetupProps) {
  const enabledEvents = useMemo(
    () => getEnabledPriorityAlertEvents(config),
    [config]
  );
  const initialPhone = extractTicketPhone(ticket.customer_data);
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [savedPhone, setSavedPhone] = useState(initialPhone ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setPhone(initialPhone ?? '');
    setSavedPhone(initialPhone ?? '');
  }, [initialPhone, ticket.id]);

  if (!config?.enabled || !config.providerReady || enabledEvents.length === 0) {
    return null;
  }

  const eventsLabel = formatPriorityAlertEvents(enabledEvents);

  async function handleSave() {
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      setErrorMessage('Enter a valid mobile number to enable text backup alerts.');
      return;
    }

    setIsSaving(true);

    try {
      const supabase = createClient();
      const existingData =
        ticket.customer_data &&
        typeof ticket.customer_data === 'object' &&
        !Array.isArray(ticket.customer_data)
          ? (ticket.customer_data as Record<string, unknown>)
          : {};

      const { error } = await supabase
        .from('tickets')
        .update({
          customer_data: {
            ...existingData,
            phone: normalizedPhone,
          },
        })
        .eq('id', ticket.id);

      if (error) throw error;

      setPhone(normalizedPhone);
      setSavedPhone(normalizedPhone);
      setSuccessMessage('Text backup alerts are ready.');
    } catch {
      setErrorMessage('Could not save your number. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-amber-950">
              Guaranteed Text Backup
            </h3>
            {savedPhone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <ShieldCheck className="h-3 w-3" />
                Ready
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-amber-900">
            Push stays primary. Add your {config.phoneLabel.toLowerCase()} if you also want a text backup for {eventsLabel}.
          </p>
          <p className="mt-1 text-xs text-amber-800">
            This helps when browsers delay or suppress alerts while your phone is locked.
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              placeholder="+1 (555) 000-0000"
              autoComplete="tel"
              className="w-full rounded-lg border border-amber-200 bg-white px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : savedPhone ? (
                'Update Number'
              ) : (
                'Enable Text Backup'
              )}
            </button>
          </div>

          {savedPhone && !successMessage && (
            <p className="mt-2 text-xs text-emerald-700">
              Backup texts will go to {savedPhone}.
            </p>
          )}
          {successMessage && (
            <p className="mt-2 text-xs text-emerald-700">{successMessage}</p>
          )}
          {errorMessage && (
            <p className="mt-2 text-xs text-destructive">{errorMessage}</p>
          )}
        </div>
      </div>
    </section>
  );
}
