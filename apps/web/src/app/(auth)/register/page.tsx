'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { register } from '@/lib/actions/auth-actions';
import { industryTemplates } from '@/lib/data/industry-templates';
import { AuthShell } from '@/components/auth/auth-shell';

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState('healthcare');
  const [selectedSubtype, setSelectedSubtype] = useState('general_clinic');
  const [operatingModel, setOperatingModel] = useState('hybrid');
  const [arrivalMode, setArrivalMode] = useState('qr_and_staff');

  const activeTemplate = useMemo(
    () => industryTemplates.find((template) => template.type === selectedType) || industryTemplates[industryTemplates.length - 1],
    [selectedType]
  );

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await register(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Start the rebuild"
      title="Create the workspace around how your customers actually arrive."
      description="We’ll use your category, operating model, and arrival preferences to shape the first QueueFlow workspace before you land in the command center."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-slate-900 transition hover:text-slate-700">
            Sign in
          </Link>
        </>
      }
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Create workspace</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Set up QueueFlow for your business</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Start with your team details, then tell us how arrivals, bookings, and service handoff work for your business.
        </p>
      </div>

      <form action={handleSubmit} className="mt-8 space-y-6">
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="organizationName" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Business name
            </label>
            <input
              id="organizationName"
              name="organizationName"
              type="text"
              required
              className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              placeholder="Downtown Clinic, Harbor Grill..."
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="fullName" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Your name
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              required
              className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              placeholder="Jordan Lee"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              placeholder="owner@business.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              placeholder="Minimum 6 characters"
            />
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Business category</label>
          <div className="grid gap-3 sm:grid-cols-2">
            {industryTemplates.slice(0, 6).map((template) => {
              const isSelected = selectedType === template.type;
              return (
                <button
                  key={template.type}
                  type="button"
                  onClick={() => {
                    setSelectedType(template.type);
                    setSelectedSubtype(template.subtypes[0]?.key || 'generic');
                  }}
                  className={`rounded-[24px] border px-4 py-4 text-left transition ${
                    isSelected
                      ? 'border-[#10292f] bg-[#10292f] text-white shadow-[0_14px_28px_rgba(16,41,47,0.16)]'
                      : 'border-slate-200 bg-[#fbfaf8] text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold">{template.label}</p>
                      <p className={`mt-1 text-sm leading-6 ${isSelected ? 'text-white/72' : 'text-slate-500'}`}>
                        {template.description}
                      </p>
                    </div>
                    {isSelected ? <Check className="mt-1 h-4 w-4 shrink-0" /> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <input type="hidden" name="businessType" value={selectedType} />
        </div>

        <div className="space-y-2">
          <label htmlFor="businessSubtype" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Business type detail
          </label>
          <select
            id="businessSubtype"
            name="businessSubtype"
            value={selectedSubtype}
            onChange={(event) => setSelectedSubtype(event.target.value)}
            className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
          >
            {activeTemplate.subtypes.map((subtype) => (
              <option key={subtype.key} value={subtype.key}>
                {subtype.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Operating model</p>
            {[
              { value: 'walkin', label: 'Mostly walk-ins', detail: 'Best for lobbies, counters, and in-person demand.' },
              { value: 'appointment', label: 'Mostly scheduled', detail: 'Best for bookings, reservations, and check-ins.' },
              { value: 'hybrid', label: 'Both walk-ins and bookings', detail: 'Best when both flows need one command center.' },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer rounded-[22px] border px-4 py-3 transition ${
                  operatingModel === option.value ? 'border-[#10292f] bg-[#edf7f2]' : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="operatingModel"
                  value={option.value}
                  checked={operatingModel === option.value}
                  onChange={() => setOperatingModel(option.value)}
                  className="sr-only"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{option.detail}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Arrival emphasis</p>
            {[
              { value: 'qr_and_staff', label: 'QR plus staff intake', detail: 'Great for walk-ins with optional self-join.' },
              { value: 'appointments_and_reservations', label: 'Bookings and reservations', detail: 'Great when most visits are pre-arranged.' },
              { value: 'kiosk_and_counter', label: 'Kiosk and front desk', detail: 'Great for guided intake on-site.' },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer rounded-[22px] border px-4 py-3 transition ${
                  arrivalMode === option.value ? 'border-[#10292f] bg-[#fff2e3]' : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="arrivalMode"
                  value={option.value}
                  checked={arrivalMode === option.value}
                  onChange={() => setArrivalMode(option.value)}
                  className="sr-only"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{option.detail}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#10292f] px-5 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:opacity-50"
        >
          {loading ? 'Creating workspace...' : 'Create workspace'}
          {!loading ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </form>
    </AuthShell>
  );
}
