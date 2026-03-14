'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';
import { industryTemplates } from '@/lib/data/industry-templates';
import { completeOnboarding, saveBusinessType } from '@/lib/actions/onboarding-actions';

interface RebuildSetupWizardProps {
  orgName: string;
  initialStep: number;
  savedBusinessType: string;
  savedBusinessSubtype: string;
  savedSettings: Record<string, unknown>;
}

const operatingOptions = [
  {
    value: 'walkin',
    label: 'Mostly walk-ins',
    detail: 'Best for front desks, service counters, and spontaneous demand.',
  },
  {
    value: 'appointment',
    label: 'Mostly appointments',
    detail: 'Best when scheduled check-ins and bookings drive the workload.',
  },
  {
    value: 'hybrid',
    label: 'Walk-ins and scheduled visits',
    detail: 'Best when both arrivals need one command center.',
  },
];

const arrivalOptions = [
  {
    value: 'qr_join',
    label: 'QR join',
    detail: 'Customers scan and join from their phone.',
  },
  {
    value: 'shared_link',
    label: 'Shared link',
    detail: 'Customers enter through your website, SMS, or social links.',
  },
  {
    value: 'staff_intake',
    label: 'Staff-created visit',
    detail: 'Front desk teams create arrivals on behalf of customers.',
  },
  {
    value: 'appointment_checkin',
    label: 'Appointment check-in',
    detail: 'Scheduled visits are checked into the live flow.',
  },
  {
    value: 'reservation_arrival',
    label: 'Reservation arrival',
    detail: 'Reservations become arrivals without side spreadsheets.',
  },
  {
    value: 'kiosk_intake',
    label: 'Kiosk intake',
    detail: 'Use an on-site screen for guided self-service.',
  },
];

const visitorExperienceOptions = [
  {
    value: 'remote_wait',
    label: 'Let customers wait away from the counter',
  },
  {
    value: 'branded_status',
    label: 'Use branded status pages and calm updates',
  },
  {
    value: 'display_boards',
    label: 'Use display boards or lobby screens',
  },
  {
    value: 'push_updates',
    label: 'Send live status updates and turn notices',
  },
];

export function RebuildSetupWizard({
  orgName,
  initialStep,
  savedBusinessType,
  savedBusinessSubtype,
  savedSettings,
}: RebuildSetupWizardProps) {
  const savedTemplate = industryTemplates.find((template) => template.type === savedBusinessType);
  const [step, setStep] = useState(Math.max(0, Math.min(initialStep, 4)));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedType, setSelectedType] = useState(savedBusinessType || 'healthcare');
  const [selectedSubtype, setSelectedSubtype] = useState(savedBusinessSubtype || savedTemplate?.subtypes[0]?.key || 'general_clinic');
  const [businessSize, setBusinessSize] = useState((savedSettings.business_size as string) || 'small');
  const [locationCount, setLocationCount] = useState((savedSettings.location_count as string) || '1');
  const [operatingMode, setOperatingMode] = useState((savedSettings.operating_mode as string) || 'hybrid');
  const [arrivalModes, setArrivalModes] = useState<string[]>(
    Array.isArray(savedSettings.arrival_modes) && savedSettings.arrival_modes.length > 0
      ? (savedSettings.arrival_modes as string[])
      : ['qr_join', 'staff_intake']
  );
  const [visitorExperience, setVisitorExperience] = useState<string[]>(
    Array.isArray(savedSettings.visitor_experience) && savedSettings.visitor_experience.length > 0
      ? (savedSettings.visitor_experience as string[])
      : ['remote_wait', 'branded_status', 'push_updates']
  );
  const [officeName, setOfficeName] = useState((savedSettings.launch_office_name as string) || `${orgName} Main`);
  const [officeAddress, setOfficeAddress] = useState((savedSettings.launch_office_address as string) || '');
  const [officeTimezone, setOfficeTimezone] = useState(
    (savedSettings.launch_office_timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone
  );

  const activeTemplate = useMemo(
    () => industryTemplates.find((template) => template.type === selectedType) || industryTemplates[industryTemplates.length - 1],
    [selectedType]
  );

  function toggleListValue(list: string[], value: string) {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  async function handleLaunch() {
    setLoading(true);
    setError('');

    const saveResult = await saveBusinessType({
      businessType: selectedType,
      businessSubtype: selectedSubtype,
      businessSize,
      locationCount,
      operatingMode,
      arrivalModes,
      visitorExperience,
      officeName,
      officeAddress,
      officeTimezone,
    });

    if (saveResult.error) {
      setError(saveResult.error);
      setLoading(false);
      return;
    }

    const launchResult = await completeOnboarding({
      office: {
        name: officeName,
        address: officeAddress || undefined,
        timezone: officeTimezone,
      },
      departments: activeTemplate.departments,
      priorities: activeTemplate.priorityCategories,
    });

    if (launchResult?.error) {
      setError(launchResult.error);
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
      <aside className="rounded-[32px] border border-white/70 bg-[#10292f] p-6 text-white shadow-[0_20px_60px_rgba(10,26,31,0.16)] lg:sticky lg:top-8 lg:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8de2d5]">Workspace setup</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Build the first QueueFlow workspace around your business model.</h1>
        <p className="mt-4 text-sm leading-7 text-white/72">
          We’re using your category template to create the first command center, service structure, and customer journey.
        </p>

        <div className="mt-8 space-y-3">
          {[
            'Business basics',
            'Operating model',
            'Arrival modes',
            'Visitor experience',
            'Launch workspace',
          ].map((label, index) => {
            const current = index === step;
            const complete = index < step;
            return (
              <div
                key={label}
                className={`flex items-center gap-3 rounded-[22px] border px-4 py-3 ${
                  current ? 'border-white/20 bg-white/10' : 'border-white/8 bg-white/5'
                }`}
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                  complete ? 'bg-white text-[#10292f]' : current ? 'bg-[#8de2d5] text-[#10292f]' : 'bg-white/10 text-white/70'
                }`}>
                  {complete ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span className={`text-sm ${current ? 'font-semibold text-white' : 'text-white/75'}`}>{label}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-[24px] border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-[#f7c98b]" />
            Category template preview
          </div>
          <p className="mt-3 text-base font-semibold text-white">{activeTemplate.label}</p>
          <p className="mt-2 text-sm leading-6 text-white/70">{activeTemplate.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {activeTemplate.featureFlags.slice(0, 4).map((flag) => (
              <span key={flag} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[12px] font-medium text-white/75">
                {flag.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      </aside>

      <div className="rounded-[32px] border border-slate-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.05)] backdrop-blur sm:p-8">
        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {step === 0 ? (
          <div className="space-y-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Step 1</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Business basics</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                Pick the category that best matches your business so QueueFlow can preload terminology, departments, and core modules.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {industryTemplates.slice(0, 8).map((template) => (
                <button
                  key={template.type}
                  type="button"
                  onClick={() => {
                    setSelectedType(template.type);
                    setSelectedSubtype(template.subtypes[0]?.key || 'generic');
                  }}
                  className={`rounded-[24px] border px-4 py-4 text-left transition ${
                    selectedType === template.type ? 'border-[#10292f] bg-[#10292f] text-white' : 'border-slate-200 bg-[#fbfaf8] text-slate-700'
                  }`}
                >
                  <p className="text-base font-semibold">{template.label}</p>
                  <p className={`mt-1 text-sm leading-6 ${selectedType === template.type ? 'text-white/72' : 'text-slate-500'}`}>
                    {template.description}
                  </p>
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Business subtype</label>
                <select
                  value={selectedSubtype}
                  onChange={(event) => setSelectedSubtype(event.target.value)}
                  className="mt-2 flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                >
                  {activeTemplate.subtypes.map((subtype) => (
                    <option key={subtype.key} value={subtype.key}>
                      {subtype.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Locations</label>
                <select
                  value={locationCount}
                  onChange={(event) => setLocationCount(event.target.value)}
                  className="mt-2 flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                >
                  <option value="1">1 location</option>
                  <option value="2-3">2-3 locations</option>
                  <option value="4-10">4-10 locations</option>
                  <option value="10+">10+ locations</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Team size</label>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                {['solo', 'small', 'medium', 'large'].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setBusinessSize(size)}
                    className={`rounded-[20px] border px-4 py-3 text-sm font-medium capitalize transition ${
                      businessSize === size ? 'border-[#10292f] bg-[#edf7f2] text-slate-900' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Step 2</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Operating model</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                Choose how visits are created so QueueFlow can shape the command center around walk-ins, appointments, or both.
              </p>
            </div>

            <div className="space-y-3">
              {operatingOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOperatingMode(option.value)}
                  className={`w-full rounded-[24px] border px-5 py-4 text-left transition ${
                    operatingMode === option.value ? 'border-[#10292f] bg-[#10292f] text-white' : 'border-slate-200 bg-[#fbfaf8] text-slate-700'
                  }`}
                >
                  <p className="text-base font-semibold">{option.label}</p>
                  <p className={`mt-1 text-sm leading-6 ${operatingMode === option.value ? 'text-white/72' : 'text-slate-500'}`}>
                    {option.detail}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Step 3</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Arrival modes</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                Turn on the intake paths your team needs today. You can start lean and expand later.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {arrivalOptions.map((option) => {
                const selected = arrivalModes.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setArrivalModes(toggleListValue(arrivalModes, option.value))}
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${
                      selected ? 'border-[#10292f] bg-[#edf7f2]' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="text-base font-semibold text-slate-900">{option.label}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{option.detail}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Step 4</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Visitor experience</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                Decide how the customer journey should feel, then set the first location that QueueFlow should launch with.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {visitorExperienceOptions.map((option) => {
                const selected = visitorExperience.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVisitorExperience(toggleListValue(visitorExperience, option.value))}
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${
                      selected ? 'border-[#10292f] bg-[#fff2e3]' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="text-base font-semibold text-slate-900">{option.label}</p>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">First location name</label>
                <input
                  value={officeName}
                  onChange={(event) => setOfficeName(event.target.value)}
                  className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                  placeholder="Main location"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Timezone</label>
                <select
                  value={officeTimezone}
                  onChange={(event) => setOfficeTimezone(event.target.value)}
                  className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                >
                  {Intl.supportedValuesOf('timeZone').map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Address</label>
              <input
                value={officeAddress}
                onChange={(event) => setOfficeAddress(event.target.value)}
                className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                placeholder="123 Main Street, City, State"
              />
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Step 5</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Launch workspace</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                QueueFlow will create the first workspace with your category template, default services, and customer experience settings.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[28px] border border-slate-200 bg-[#fbfaf8] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Workspace summary</p>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div className="flex items-center justify-between"><span>Category</span><span className="font-semibold text-slate-900">{activeTemplate.label}</span></div>
                  <div className="flex items-center justify-between"><span>Subtype</span><span className="font-semibold text-slate-900">{selectedSubtype.replace(/_/g, ' ')}</span></div>
                  <div className="flex items-center justify-between"><span>Operating model</span><span className="font-semibold text-slate-900">{operatingMode}</span></div>
                  <div className="flex items-center justify-between"><span>First location</span><span className="font-semibold text-slate-900">{officeName}</span></div>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">What gets created</p>
                <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <p>{activeTemplate.departments.length} departments or work areas from the {activeTemplate.label} template.</p>
                  <p>{activeTemplate.priorityCategories.length} priority rules ready for routing and customer handling.</p>
                  <p>{arrivalModes.length} active intake paths and {visitorExperience.length} visitor experience preferences saved to the workspace settings.</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-6">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0 || loading}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={(step === 2 && arrivalModes.length === 0) || (step === 3 && !officeName.trim()) || loading}
              className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:opacity-50"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLaunch}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {loading ? 'Launching workspace...' : 'Launch QueueFlow'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
