'use client';

import { useState } from 'react';
import {
  UtensilsCrossed, Stethoscope, Landmark, Building, Hotel,
  ShoppingBag, Scissors, Pill, GraduationCap, Smartphone,
  Car, Home, Dumbbell, Plane, Scale, Truck, Ticket, Laptop,
  Wrench, Building2, ArrowLeft, ArrowRight, Check, Plus,
  Trash2, ChevronDown, ChevronUp, Loader2, MapPin, Clock,
  type LucideIcon,
} from 'lucide-react';
import { industryTemplates, getIndustryTemplate } from '@/lib/data/industry-templates';
import type { IndustryTemplate, TemplateDepartment, TemplatePriority } from '@/lib/data/industry-templates';
import { saveBusinessType, completeOnboarding } from '@/lib/actions/onboarding-actions';

const iconMap: Record<string, LucideIcon> = {
  UtensilsCrossed, Stethoscope, Landmark, Building, Hotel,
  ShoppingBag, Scissors, Pill, GraduationCap, Smartphone,
  Car, Home, Dumbbell, Plane, Scale, Truck, Ticket, Laptop,
  Wrench, Building2,
};

interface SetupWizardProps {
  orgId: string;
  orgName: string;
  initialStep: number;
  savedBusinessType: string;
  savedBusinessSubtype: string;
}

interface DeptState {
  name: string;
  code: string;
  services: { name: string; code: string; estimatedTime: number }[];
  expanded: boolean;
}

export function SetupWizard({
  orgName,
  initialStep,
  savedBusinessType,
  savedBusinessSubtype,
}: SetupWizardProps) {
  const [step, setStep] = useState(initialStep >= 2 ? Math.min(initialStep, 2) : 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Business category
  const [selectedType, setSelectedType] = useState(savedBusinessType);

  // Step 2: Details
  const [selectedSubtype, setSelectedSubtype] = useState(savedBusinessSubtype);
  const [businessSize, setBusinessSize] = useState('small');
  const [locationCount, setLocationCount] = useState('1');
  const [operatingMode, setOperatingMode] = useState('walkin');

  // Step 3: Template customization
  const [departments, setDepartments] = useState<DeptState[]>([]);
  const [priorities, setPriorities] = useState<TemplatePriority[]>([]);

  // Step 4: Office
  const [officeName, setOfficeName] = useState(`${orgName} - Main`);
  const [officeAddress, setOfficeAddress] = useState('');
  const [officeTimezone, setOfficeTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );

  const totalSteps = 5;
  const currentTemplate = getIndustryTemplate(selectedType);

  function loadTemplate(template: IndustryTemplate) {
    setDepartments(
      template.departments.map((d) => ({
        ...d,
        expanded: false,
      }))
    );
    setPriorities([...template.priorityCategories]);
  }

  async function handleStep1Next() {
    if (!selectedType) return;
    setStep(1);
  }

  async function handleStep2Next() {
    if (!selectedSubtype) return;
    setLoading(true);
    setError('');

    const result = await saveBusinessType({
      businessType: selectedType,
      businessSubtype: selectedSubtype,
      businessSize,
      locationCount,
      operatingMode,
    });

    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }

    // Load template for step 3
    if (currentTemplate) {
      loadTemplate(currentTemplate);
    }
    setStep(2);
  }

  async function handleFinish() {
    setLoading(true);
    setError('');

    const result = await completeOnboarding({
      office: {
        name: officeName,
        address: officeAddress || undefined,
        timezone: officeTimezone,
      },
      departments: departments.map((d) => ({
        name: d.name,
        code: d.code,
        services: d.services,
      })),
      priorities,
    });

    setLoading(false);
    if (result?.error) {
      setError(result.error);
    }
    // completeOnboarding redirects on success
  }

  // Department management
  function toggleDept(index: number) {
    setDepartments((prev) =>
      prev.map((d, i) => (i === index ? { ...d, expanded: !d.expanded } : d))
    );
  }

  function updateDeptName(index: number, name: string) {
    setDepartments((prev) =>
      prev.map((d, i) => (i === index ? { ...d, name } : d))
    );
  }

  function removeDept(index: number) {
    setDepartments((prev) => prev.filter((_, i) => i !== index));
  }

  function addDept() {
    setDepartments((prev) => [
      ...prev,
      { name: 'New Department', code: `DEP${prev.length + 1}`, services: [], expanded: true },
    ]);
  }

  function updateService(deptIdx: number, svcIdx: number, field: string, value: string | number) {
    setDepartments((prev) =>
      prev.map((d, di) =>
        di === deptIdx
          ? {
              ...d,
              services: d.services.map((s, si) =>
                si === svcIdx ? { ...s, [field]: value } : s
              ),
            }
          : d
      )
    );
  }

  function removeService(deptIdx: number, svcIdx: number) {
    setDepartments((prev) =>
      prev.map((d, di) =>
        di === deptIdx
          ? { ...d, services: d.services.filter((_, si) => si !== svcIdx) }
          : d
      )
    );
  }

  function addService(deptIdx: number) {
    setDepartments((prev) =>
      prev.map((d, di) =>
        di === deptIdx
          ? {
              ...d,
              services: [
                ...d.services,
                { name: 'New Service', code: `SVC${d.services.length + 1}`, estimatedTime: 10 },
              ],
            }
          : d
      )
    );
  }

  function removePriority(index: number) {
    setPriorities((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-8">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-gray-400 uppercase tracking-widest">
          <span>Step {step + 1} of {totalSteps}</span>
          <span>{['Business Type', 'Details', 'Customize', 'Location', 'Launch'][step]}</span>
        </div>
        <div className="h-1 rounded-full bg-gray-100">
          <div
            className="h-1 rounded-full bg-gray-900 transition-all duration-300"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 0: Select Business Category */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">What type of business do you run?</h1>
            <p className="mt-1 text-sm text-gray-500">
              We'll customize your dashboard, terminology, and services to match your industry.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {industryTemplates.map((template) => {
              const Icon = iconMap[template.icon] || Building2;
              const isSelected = selectedType === template.type;
              return (
                <button
                  key={template.type}
                  onClick={() => setSelectedType(template.type)}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
                    isSelected
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-gray-100 hover:border-gray-300'
                  }`}
                >
                  <Icon className={`h-6 w-6 ${isSelected ? 'text-gray-900' : 'text-gray-400'}`} />
                  <span className={`text-xs font-medium ${isSelected ? 'text-gray-900' : 'text-gray-600'}`}>
                    {template.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleStep1Next}
              disabled={!selectedType}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Business Details */}
      {step === 1 && currentTemplate && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tell us more about your {currentTemplate.label.toLowerCase()}</h1>
            <p className="mt-1 text-sm text-gray-500">
              This helps us fine-tune your setup.
            </p>
          </div>

          {/* Subtypes */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
              Type
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {currentTemplate.subtypes.map((sub) => (
                <button
                  key={sub.key}
                  onClick={() => setSelectedSubtype(sub.key)}
                  className={`rounded-lg border-2 p-3 text-left transition-all ${
                    selectedSubtype === sub.key
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-gray-100 hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-medium text-gray-900">{sub.label}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{sub.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Business Size */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
              Team Size
            </label>
            <div className="grid grid-cols-4 gap-3">
              {[
                { key: 'solo', label: 'Solo' },
                { key: 'small', label: '1-5' },
                { key: 'medium', label: '6-20' },
                { key: 'large', label: '20+' },
              ].map((s) => (
                <button
                  key={s.key}
                  onClick={() => setBusinessSize(s.key)}
                  className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
                    businessSize === s.key
                      ? 'border-gray-900 bg-gray-50 text-gray-900'
                      : 'border-gray-100 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Location Count */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
              Number of Locations
            </label>
            <div className="grid grid-cols-4 gap-3">
              {[
                { key: '1', label: '1' },
                { key: '2-3', label: '2-3' },
                { key: '4-10', label: '4-10' },
                { key: '10+', label: '10+' },
              ].map((l) => (
                <button
                  key={l.key}
                  onClick={() => setLocationCount(l.key)}
                  className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
                    locationCount === l.key
                      ? 'border-gray-900 bg-gray-50 text-gray-900'
                      : 'border-gray-100 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Operating Mode */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
              How do customers visit?
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: 'walkin', label: 'Walk-in Only' },
                { key: 'appointment', label: 'Appointments Only' },
                { key: 'hybrid', label: 'Both' },
              ].map((m) => (
                <button
                  key={m.key}
                  onClick={() => setOperatingMode(m.key)}
                  className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
                    operatingMode === m.key
                      ? 'border-gray-900 bg-gray-50 text-gray-900'
                      : 'border-gray-100 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(0)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={handleStep2Next}
              disabled={!selectedSubtype || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Customize Template */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Customize your setup</h1>
            <p className="mt-1 text-sm text-gray-500">
              We've pre-populated departments and services for you. Add, remove, or rename anything.
              You can always change this later.
            </p>
          </div>

          {/* Departments */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
                {currentTemplate?.terminology.departmentPlural || 'Departments'} & Services
              </label>
              <button
                onClick={addDept}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-900 hover:text-gray-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>

            <div className="space-y-2">
              {departments.map((dept, deptIdx) => (
                <div key={deptIdx} className="rounded-lg border border-gray-200">
                  <div
                    className="flex cursor-pointer items-center justify-between p-3"
                    onClick={() => toggleDept(deptIdx)}
                  >
                    <div className="flex items-center gap-3">
                      {dept.expanded ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                      <input
                        type="text"
                        value={dept.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateDeptName(deptIdx, e.target.value)}
                        className="border-0 bg-transparent p-0 text-sm font-medium text-gray-900 focus:outline-none focus:ring-0"
                      />
                      <span className="text-xs text-gray-400">
                        {dept.services.length} service{dept.services.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeDept(deptIdx);
                      }}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {dept.expanded && (
                    <div className="border-t border-gray-100 p-3 pt-2">
                      <div className="space-y-2">
                        {dept.services.map((svc, svcIdx) => (
                          <div key={svcIdx} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={svc.name}
                              onChange={(e) => updateService(deptIdx, svcIdx, 'name', e.target.value)}
                              className="flex-1 rounded border border-gray-200 px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                            />
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-gray-400" />
                              <input
                                type="number"
                                value={svc.estimatedTime}
                                onChange={(e) =>
                                  updateService(deptIdx, svcIdx, 'estimatedTime', parseInt(e.target.value) || 0)
                                }
                                className="w-14 rounded border border-gray-200 px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                                min={1}
                              />
                              <span className="text-xs text-gray-400">min</span>
                            </div>
                            <button
                              onClick={() => removeService(deptIdx, svcIdx)}
                              className="rounded p-1 text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => addService(deptIdx)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
                      >
                        <Plus className="h-3 w-3" />
                        Add service
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Priority Categories */}
          <div className="space-y-3">
            <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
              Priority Categories
            </label>
            <div className="flex flex-wrap gap-2">
              {priorities.map((p, idx) => (
                <div
                  key={idx}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5"
                >
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="text-sm text-gray-700">{p.name}</span>
                  <span className="text-xs text-gray-400">w:{p.weight}</span>
                  <button
                    onClick={() => removePriority(idx)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={departments.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Create First Location */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create your first {currentTemplate?.terminology.office.toLowerCase() || 'location'}</h1>
            <p className="mt-1 text-sm text-gray-500">
              You can add more {currentTemplate?.terminology.officePlural.toLowerCase() || 'locations'} later.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
                {currentTemplate?.terminology.office || 'Location'} Name
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                  placeholder="Main Office"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
                Address (optional)
              </label>
              <input
                type="text"
                value={officeAddress}
                onChange={(e) => setOfficeAddress(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                placeholder="123 Main St, City, State"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
                Timezone
              </label>
              <select
                value={officeTimezone}
                onChange={(e) => setOfficeTimezone(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
              >
                {Intl.supportedValuesOf('timeZone').map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={!officeName.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Launch */}
      {step === 4 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ready to launch</h1>
            <p className="mt-1 text-sm text-gray-500">
              Review your setup and start managing your queue.
            </p>
          </div>

          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">{currentTemplate?.label || selectedType}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Business Type</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">{departments.length}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">
                  {currentTemplate?.terminology.departmentPlural || 'Departments'}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">
                  {departments.reduce((sum, d) => sum + d.services.length, 0)}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Services</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">{priorities.length}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Priorities</div>
              </div>
            </div>

            {/* Location */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-2">
                First {currentTemplate?.terminology.office || 'Location'}
              </div>
              <div className="text-sm font-medium text-gray-900">{officeName}</div>
              {officeAddress && (
                <div className="text-sm text-gray-500 mt-0.5">{officeAddress}</div>
              )}
              <div className="text-xs text-gray-400 mt-0.5">{officeTimezone}</div>
            </div>

            {/* Departments list */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-3">
                {currentTemplate?.terminology.departmentPlural || 'Departments'} & Services
              </div>
              <div className="space-y-3">
                {departments.map((dept, idx) => (
                  <div key={idx}>
                    <div className="text-sm font-medium text-gray-900">{dept.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {dept.services.map((svc, si) => (
                        <span
                          key={si}
                          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                        >
                          {svc.name}
                          <span className="text-gray-400">{svc.estimatedTime}m</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={handleFinish}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-8 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Launch Your Queue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
