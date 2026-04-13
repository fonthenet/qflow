'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { IndustryTemplate, CapabilityFlags } from '@qflo/shared';
import { ArrowLeft, CheckCircle2, LayoutTemplate, Save, Sliders, Tags, Volume2 } from 'lucide-react';
import { getProfilesForVertical, type TemplateProfile } from '@/lib/platform/template-profiles';
import { saveTemplateCustomization } from '@/lib/actions/platform-actions';
import { useI18n } from '@/components/providers/locale-provider';

interface TemplateCustomizationClientProps {
  organizationId: string;
  templateId: string;
  profileId?: string;
  currentOverrides: Record<string, unknown>;
  template: IndustryTemplate;
}

type CapabilityKey = keyof CapabilityFlags;

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  appointments: 'Appointments',
  virtualJoin: 'Virtual Queue Join',
  kiosk: 'Kiosk Check-in',
  displayBoard: 'Display Boards',
  branchComparison: 'Branch Comparison',
  customerHistory: 'Customer History',
  feedback: 'Customer Feedback',
  staffAssignment: 'Staff Assignment',
  deviceIntegrations: 'Device Integrations',
  intakeForms: 'Intake Forms',
  multiDepartment: 'Multi-Department',
  privacySafeDisplay: 'Privacy-Safe Display',
};

const CAPABILITY_DESCRIPTIONS: Record<CapabilityKey, string> = {
  appointments: 'Allow customers to book appointments ahead of time',
  virtualJoin: 'Let customers join the queue remotely via link or QR code',
  kiosk: 'Self-service check-in stations for walk-in customers',
  displayBoard: 'Public display screens showing queue status',
  branchComparison: 'Compare wait times across multiple locations',
  customerHistory: 'Track returning customers and visit history',
  feedback: 'Collect satisfaction ratings after service',
  staffAssignment: 'Assign specific staff to desks and services',
  deviceIntegrations: 'Connect ticket printers and hardware devices',
  intakeForms: 'Collect information during check-in',
  multiDepartment: 'Route customers between multiple departments',
  privacySafeDisplay: 'Hide customer names on public displays',
};

export function TemplateCustomizationClient({
  organizationId,
  templateId,
  profileId: initialProfileId,
  currentOverrides,
  template,
}: TemplateCustomizationClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const profiles = getProfilesForVertical(template.vertical);

  const [selectedProfileId, setSelectedProfileId] = useState(initialProfileId ?? '');
  const [capabilityOverrides, setCapabilityOverrides] = useState<Partial<CapabilityFlags>>(
    (currentOverrides.capabilityFlags as Partial<CapabilityFlags>) ?? {}
  );
  const [vocabularyOverrides, setVocabularyOverrides] = useState<Record<string, string>>(
    (currentOverrides.experienceProfile as any)?.vocabulary ?? {}
  );
  const [messagingTone, setMessagingTone] = useState(
    (currentOverrides.experienceProfile as any)?.messagingTone ?? template.experienceProfile.messagingTone
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  const vocabulary = template.experienceProfile.vocabulary;

  function toggleCapability(key: CapabilityKey) {
    setCapabilityOverrides((prev) => {
      const currentValue = prev[key] ?? template.capabilityFlags[key];
      return { ...prev, [key]: !currentValue };
    });
  }

  function getCapabilityValue(key: CapabilityKey): boolean {
    return capabilityOverrides[key] ?? template.capabilityFlags[key];
  }

  function updateVocabulary(key: string, value: string) {
    setVocabularyOverrides((prev) => {
      if (!value || value === (vocabulary as any)[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }

  function buildOverrides(): Record<string, unknown> {
    const overrides: Record<string, unknown> = {};

    if (Object.keys(capabilityOverrides).length > 0) {
      overrides.capabilityFlags = capabilityOverrides;
    }

    const expOverrides: Record<string, unknown> = {};
    if (Object.keys(vocabularyOverrides).length > 0) {
      expOverrides.vocabulary = vocabularyOverrides;
    }
    if (messagingTone !== template.experienceProfile.messagingTone) {
      expOverrides.messagingTone = messagingTone;
    }
    if (Object.keys(expOverrides).length > 0) {
      overrides.experienceProfile = expOverrides;
    }

    return overrides;
  }

  function handleSave() {
    setErrorMessage(null);
    setSuccessMessage(null);

    startTransition(async () => {
      const overrides = buildOverrides();
      const result = await saveTemplateCustomization({
        profileId: selectedProfileId || undefined,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      });

      if (result && 'error' in result && result.error) {
        setErrorMessage(result.error);
        return;
      }

      setSuccessMessage('Customization saved.');
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/settings"
          className="rounded-xl border border-border p-2 hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Template Customization')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('Fine-tune your {template} template settings', { template: template.title })}
          </p>
        </div>
      </div>

      {successMessage ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {/* Profile selection */}
      {profiles.length > 1 ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">{t('Business Profile')}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Switch your business profile to get different defaults for vocabulary, services, and branding.')}
          </p>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((profile) => {
              const active = profile.id === selectedProfileId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border bg-background hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{profile.icon}</span>
                    <p className="text-sm font-semibold text-foreground">{profile.title}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{profile.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Capability toggles */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">{t('Capabilities')}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Enable or disable features for your business.')}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(Object.keys(CAPABILITY_LABELS) as CapabilityKey[]).map((key) => (
            <label
              key={key}
              className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 cursor-pointer hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={getCapabilityValue(key)}
                onChange={() => toggleCapability(key)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{CAPABILITY_LABELS[key]}</p>
                <p className="text-xs text-muted-foreground">{CAPABILITY_DESCRIPTIONS[key]}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Vocabulary customization */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Tags className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">{t('Vocabulary')}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Rename labels to match how your business talks. Leave blank to use the template default.')}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {([
            ['officeLabel', 'Location label'],
            ['departmentLabel', 'Department label'],
            ['serviceLabel', 'Service label'],
            ['deskLabel', 'Counter label'],
            ['customerLabel', 'Customer label'],
            ['bookingLabel', 'Booking label'],
            ['queueLabel', 'Queue label'],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">
                {t(label)}
              </label>
              <input
                value={vocabularyOverrides[key] ?? ''}
                onChange={(e) => updateVocabulary(key, e.target.value)}
                placeholder={(vocabulary as any)[key]}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Messaging tone */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">{t('Messaging Tone')}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Set the tone for customer-facing messages.')}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {(['institutional', 'professional', 'friendly'] as const).map((tone) => (
            <button
              key={tone}
              type="button"
              onClick={() => setMessagingTone(tone)}
              className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                messagingTone === tone
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border bg-background text-foreground hover:border-primary/40'
              }`}
            >
              {tone.charAt(0).toUpperCase() + tone.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-3">
        <Link
          href="/admin/settings"
          className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          {t('Cancel')}
        </Link>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {isSaving ? t('Saving...') : t('Save customization')}
        </button>
      </div>
    </div>
  );
}
