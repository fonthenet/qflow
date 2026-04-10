'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  Loader2,
  Monitor,
  Shield,
  MapPin,
  User,
} from 'lucide-react';
import type { RoleDefinition } from '@qflo/shared';
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@qflo/shared';
import { createStaffMember } from '@/lib/actions/admin-actions';

interface Vocabulary {
  deskLabel: string;
  departmentLabel: string;
  officeLabel: string;
  serviceLabel: string;
  customerLabel: string;
  queueLabel?: string;
}

type Office = { id: string; name: string };
type Department = {
  id: string;
  name: string;
  office_id: string;
  office: { id: string; name: string } | null;
};
type Desk = {
  id: string;
  name: string;
  display_name: string | null;
  office_id: string;
  department_id: string;
  is_active: boolean;
  current_staff_id: string | null;
};

const STEPS = ['Account', 'Role', 'Location', 'Review'] as const;
type Step = (typeof STEPS)[number];

function roleHelpText(role: string, vocab: Vocabulary) {
  const desk = vocab.deskLabel.toLowerCase();
  const customer = vocab.customerLabel.toLowerCase();
  switch (role) {
    case STAFF_ROLES.ADMIN:
      return 'Full business control — setup, team, reports, and live operations.';
    case STAFF_ROLES.MANAGER:
      return 'Runs the business day to day with setup access and reporting.';
    case STAFF_ROLES.BRANCH_ADMIN:
      return `Manages one ${vocab.officeLabel.toLowerCase()} and its service flow.`;
    case STAFF_ROLES.RECEPTIONIST:
      return `Checks ${customer}s in and helps at the front ${desk}.`;
    case STAFF_ROLES.DESK_OPERATOR:
      return `Calls and serves ${customer}s at a ${desk}.`;
    case STAFF_ROLES.FLOOR_MANAGER:
      return 'Supervises live operations and helps unblock queues.';
    case STAFF_ROLES.ANALYST:
      return `Views reports, ${customer} history, and business activity.`;
    case STAFF_ROLES.AGENT:
      return `Legacy basic ${desk} access.`;
    default:
      return 'Business access based on the assigned role.';
  }
}

function needsLocation(role: string): boolean {
  return [
    STAFF_ROLES.DESK_OPERATOR,
    STAFF_ROLES.RECEPTIONIST,
    STAFF_ROLES.FLOOR_MANAGER,
    STAFF_ROLES.BRANCH_ADMIN,
    STAFF_ROLES.AGENT,
  ].includes(role as any);
}

export function StaffSetupWizard({
  offices,
  departments,
  desks,
  roleDefinitions,
  vocabulary,
}: {
  offices: Office[];
  departments: Department[];
  desks: Desk[];
  roleDefinitions: RoleDefinition[];
  vocabulary: Vocabulary;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [createdEmail, setCreatedEmail] = useState('');

  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sendSetupEmail, setSendSetupEmail] = useState(true);
  const [selectedRole, setSelectedRole] = useState<string>(STAFF_ROLES.DESK_OPERATOR);
  const [selectedOfficeId, setSelectedOfficeId] = useState(offices.length === 1 ? offices[0].id : '');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [selectedDeskId, setSelectedDeskId] = useState('');

  const filteredDepartments = useMemo(
    () =>
      selectedOfficeId
        ? departments.filter((d) => d.office_id === selectedOfficeId)
        : departments,
    [departments, selectedOfficeId]
  );

  const filteredDesks = useMemo(() => {
    let filtered = desks.filter((d) => d.current_staff_id === null);
    if (selectedOfficeId) filtered = filtered.filter((d) => d.office_id === selectedOfficeId);
    if (selectedDepartmentId) filtered = filtered.filter((d) => d.department_id === selectedDepartmentId);
    return filtered;
  }, [desks, selectedOfficeId, selectedDepartmentId]);

  const selectedRoleDefinition = roleDefinitions.find((r) => r.role === selectedRole);
  const showLocationStep = needsLocation(selectedRole);

  const effectiveSteps = showLocationStep
    ? STEPS
    : (['Account', 'Role', 'Review'] as const);

  const stepIndex = (step: string) =>
    (effectiveSteps as readonly string[]).indexOf(step);

  function canAdvance(): boolean {
    const step = effectiveSteps[currentStep];
    if (step === 'Account') return !!fullName.trim() && !!email.trim() && !!password && password.length >= 6;
    if (step === 'Role') return !!selectedRole;
    if (step === 'Location') return !!selectedOfficeId;
    return true;
  }

  function goNext() {
    if (currentStep < effectiveSteps.length - 1) {
      setError(null);
      setCurrentStep((s) => s + 1);
    }
  }

  function goBack() {
    if (currentStep > 0) {
      setError(null);
      setCurrentStep((s) => s - 1);
    }
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('full_name', fullName.trim());
      formData.set('email', email.trim().toLowerCase());
      formData.set('password', password);
      formData.set('role', selectedRole);
      if (selectedOfficeId) formData.set('office_id', selectedOfficeId);
      if (selectedDepartmentId) formData.set('department_id', selectedDepartmentId);
      if (selectedDeskId) formData.set('desk_id', selectedDeskId);
      if (sendSetupEmail) formData.set('send_setup_email', 'true');
      formData.set('is_active', 'true');

      const result = await createStaffMember(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }

      setCreatedEmail(email.trim().toLowerCase());
      setCompleted(true);
    });
  }

  if (completed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
            <Check className="h-10 w-10 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Team member added!</h1>
          <p className="mt-3 text-muted-foreground">
            <span className="font-medium text-foreground">{fullName}</span> ({createdEmail}) has been added as{' '}
            <span className="font-medium text-foreground">
              {STAFF_ROLE_LABELS[selectedRole as keyof typeof STAFF_ROLE_LABELS] ?? selectedRole}
            </span>
            {selectedOfficeId && (
              <>
                {' '}at{' '}
                <span className="font-medium text-foreground">
                  {offices.find((o) => o.id === selectedOfficeId)?.name}
                </span>
              </>
            )}
            .
          </p>
          {sendSetupEmail && (
            <p className="mt-2 text-sm text-muted-foreground">
              A setup email has been sent so they can sign in.
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              onClick={() => {
                setCompleted(false);
                setCurrentStep(0);
                setFullName('');
                setEmail('');
                setPassword('');
                setSelectedRole(STAFF_ROLES.DESK_OPERATOR);
                setSelectedOfficeId(offices.length === 1 ? offices[0].id : '');
                setSelectedDepartmentId('');
                setSelectedDeskId('');
                setError(null);
              }}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors"
            >
              Add another member
            </button>
            <button
              onClick={() => router.push('/admin/staff')}
              className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Back to Team
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.push('/admin/staff')}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Team
        </button>
        <h1 className="text-2xl font-bold tracking-tight">Add Team Member</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up a new team member step by step.
        </p>
      </div>

      {/* Progress */}
      <div className="mb-8 flex items-center gap-2">
        {effectiveSteps.map((step, i) => {
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          return (
            <div key={step} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
                  isDone
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                      ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {isDone ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`hidden text-sm font-medium sm:block ${
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {step === 'Location' ? vocabulary.officeLabel : step}
              </span>
              {i < effectiveSteps.length - 1 && (
                <div
                  className={`ml-2 h-0.5 flex-1 rounded-full transition-colors ${
                    isDone ? 'bg-primary' : 'bg-border'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step Content */}
      <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
        {effectiveSteps[currentStep] === 'Account' && (
          <StepAccount
            fullName={fullName}
            setFullName={setFullName}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            sendSetupEmail={sendSetupEmail}
            setSendSetupEmail={setSendSetupEmail}
          />
        )}

        {effectiveSteps[currentStep] === 'Role' && (
          <StepRole
            roleDefinitions={roleDefinitions}
            selectedRole={selectedRole}
            setSelectedRole={setSelectedRole}
            vocabulary={vocabulary}
          />
        )}

        {effectiveSteps[currentStep] === 'Location' && (
          <StepLocation
            offices={offices}
            departments={filteredDepartments}
            desks={filteredDesks}
            selectedOfficeId={selectedOfficeId}
            setSelectedOfficeId={(id) => {
              setSelectedOfficeId(id);
              setSelectedDepartmentId('');
              setSelectedDeskId('');
            }}
            selectedDepartmentId={selectedDepartmentId}
            setSelectedDepartmentId={(id) => {
              setSelectedDepartmentId(id);
              setSelectedDeskId('');
            }}
            selectedDeskId={selectedDeskId}
            setSelectedDeskId={setSelectedDeskId}
            vocabulary={vocabulary}
          />
        )}

        {effectiveSteps[currentStep] === 'Review' && (
          <StepReview
            fullName={fullName}
            email={email}
            selectedRole={selectedRole}
            selectedOfficeId={selectedOfficeId}
            selectedDepartmentId={selectedDepartmentId}
            selectedDeskId={selectedDeskId}
            offices={offices}
            departments={departments}
            desks={desks}
            roleDefinitions={roleDefinitions}
            vocabulary={vocabulary}
            sendSetupEmail={sendSetupEmail}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={goBack}
          disabled={currentStep === 0}
          className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {currentStep < effectiveSteps.length - 1 ? (
          <button
            onClick={goNext}
            disabled={!canAdvance()}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isPending || !canAdvance()}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Create Member
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Step 1: Account ────────────────────────────────────────────────── */

function StepAccount({
  fullName,
  setFullName,
  email,
  setEmail,
  password,
  setPassword,
  sendSetupEmail,
  setSendSetupEmail,
}: {
  fullName: string;
  setFullName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  sendSetupEmail: boolean;
  setSendSetupEmail: (v: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Account Details</h2>
          <p className="text-sm text-muted-foreground">Basic info and login credentials</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Full name
          </label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Smith"
            autoFocus
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Temporary password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min 6 characters"
          minLength={6}
          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          They can use this right away, then change it later.
        </p>
      </div>

      <label className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={sendSetupEmail}
          onChange={(e) => setSendSetupEmail(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Send setup email</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Sends a password setup email so they can sign in without sharing the password.
          </span>
        </span>
      </label>
    </div>
  );
}

/* ── Step 2: Role ───────────────────────────────────────────────────── */

function StepRole({
  roleDefinitions,
  selectedRole,
  setSelectedRole,
  vocabulary,
}: {
  roleDefinitions: RoleDefinition[];
  selectedRole: string;
  setSelectedRole: (v: string) => void;
  vocabulary: Vocabulary;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Choose Role</h2>
          <p className="text-sm text-muted-foreground">
            What will this person do?
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {roleDefinitions.map((rd) => {
          const isSelected = selectedRole === rd.role;
          return (
            <button
              key={rd.role}
              onClick={() => setSelectedRole(rd.role)}
              className={`relative rounded-xl border-2 p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-border hover:border-primary/30 hover:bg-muted/50'
              }`}
            >
              {isSelected && (
                <div className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
              )}
              <p className="text-sm font-bold text-foreground">
                {STAFF_ROLE_LABELS[rd.role] ?? rd.label}
              </p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {roleHelpText(rd.role, vocabulary)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Step 3: Location ───────────────────────────────────────────────── */

function StepLocation({
  offices,
  departments,
  desks,
  selectedOfficeId,
  setSelectedOfficeId,
  selectedDepartmentId,
  setSelectedDepartmentId,
  selectedDeskId,
  setSelectedDeskId,
  vocabulary,
}: {
  offices: Office[];
  departments: Department[];
  desks: Desk[];
  selectedOfficeId: string;
  setSelectedOfficeId: (v: string) => void;
  selectedDepartmentId: string;
  setSelectedDepartmentId: (v: string) => void;
  selectedDeskId: string;
  setSelectedDeskId: (v: string) => void;
  vocabulary: Vocabulary;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <MapPin className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Assign {vocabulary.officeLabel}
          </h2>
          <p className="text-sm text-muted-foreground">
            Where will this person work?
          </p>
        </div>
      </div>

      {/* Office */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {vocabulary.officeLabel}
        </label>
        {offices.length <= 4 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {offices.map((office) => {
              const isSelected = selectedOfficeId === office.id;
              return (
                <button
                  key={office.id}
                  onClick={() => setSelectedOfficeId(office.id)}
                  className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/30 hover:bg-muted/50'
                  }`}
                >
                  <MapPin
                    className={`h-5 w-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                  />
                  <span className="text-sm font-medium text-foreground">{office.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <select
            value={selectedOfficeId}
            onChange={(e) => setSelectedOfficeId(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          >
            <option value="">Select {vocabulary.officeLabel.toLowerCase()}...</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Department (optional) */}
      {selectedOfficeId && departments.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {vocabulary.departmentLabel}
            <span className="ml-1 text-muted-foreground font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <select
            value={selectedDepartmentId}
            onChange={(e) => setSelectedDepartmentId(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          >
            <option value="">All {vocabulary.departmentLabel.toLowerCase()}s</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Restrict this person to a specific {vocabulary.departmentLabel.toLowerCase()}, or leave blank for all.
          </p>
        </div>
      )}

      {/* Default desk (informational) */}
      {selectedOfficeId && desks.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Default {vocabulary.deskLabel}
            <span className="ml-1 text-muted-foreground font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {desks.slice(0, 8).map((desk) => {
              const isSelected = selectedDeskId === desk.id;
              return (
                <button
                  key={desk.id}
                  onClick={() => setSelectedDeskId(isSelected ? '' : desk.id)}
                  className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/30 hover:bg-muted/50'
                  }`}
                >
                  <Monitor
                    className={`h-4 w-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {desk.display_name ?? desk.name}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            They can also pick their {vocabulary.deskLabel.toLowerCase()} when they sign in.
          </p>
        </div>
      )}

      {selectedOfficeId && desks.length === 0 && (
        <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            No available {vocabulary.deskLabel.toLowerCase()}s at this {vocabulary.officeLabel.toLowerCase()}.
            They&apos;ll choose one when they sign in, or you can create {vocabulary.deskLabel.toLowerCase()}s in the{' '}
            <span className="font-medium text-foreground">{vocabulary.deskLabel}s</span> settings page.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Step 4: Review ─────────────────────────────────────────────────── */

function StepReview({
  fullName,
  email,
  selectedRole,
  selectedOfficeId,
  selectedDepartmentId,
  selectedDeskId,
  offices,
  departments,
  desks,
  roleDefinitions,
  vocabulary,
  sendSetupEmail,
}: {
  fullName: string;
  email: string;
  selectedRole: string;
  selectedOfficeId: string;
  selectedDepartmentId: string;
  selectedDeskId: string;
  offices: Office[];
  departments: Department[];
  desks: Desk[];
  roleDefinitions: RoleDefinition[];
  vocabulary: Vocabulary;
  sendSetupEmail: boolean;
}) {
  const office = offices.find((o) => o.id === selectedOfficeId);
  const dept = departments.find((d) => d.id === selectedDepartmentId);
  const desk = desks.find((d) => d.id === selectedDeskId);
  const roleDef = roleDefinitions.find((r) => r.role === selectedRole);

  const items: { label: string; value: string }[] = [
    { label: 'Name', value: fullName },
  ];

  if (email) {
    items.push({ label: 'Email', value: email });
  }

  items.push({
    label: 'Role',
    value: STAFF_ROLE_LABELS[selectedRole as keyof typeof STAFF_ROLE_LABELS] ?? selectedRole,
  });

  if (office) {
    items.push({ label: vocabulary.officeLabel, value: office.name });
  }

  if (dept) {
    items.push({ label: vocabulary.departmentLabel, value: dept.name });
  }

  if (desk) {
    items.push({ label: vocabulary.deskLabel, value: desk.display_name ?? desk.name });
  }

  items.push({ label: 'Setup email', value: sendSetupEmail ? 'Will be sent' : 'Not sending' });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
          <Check className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Review & Confirm</h2>
          <p className="text-sm text-muted-foreground">
            Make sure everything looks right before creating.
          </p>
        </div>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border/60 overflow-hidden">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{item.label}</span>
            <span className="text-sm font-medium text-foreground">{item.value}</span>
          </div>
        ))}
      </div>

      {roleDef && (
        <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Permissions
          </p>
          <p className="text-sm text-muted-foreground">
            {roleHelpText(selectedRole, vocabulary)}
          </p>
        </div>
      )}
    </div>
  );
}
