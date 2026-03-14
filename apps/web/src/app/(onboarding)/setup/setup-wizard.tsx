'use client';

import { RebuildSetupWizard } from '@/components/onboarding/rebuild-setup-wizard';

interface SetupWizardProps {
  orgId: string;
  orgName: string;
  initialStep: number;
  savedBusinessType: string;
  savedBusinessSubtype: string;
  savedSettings: Record<string, unknown>;
}

export function SetupWizard({
  orgName,
  initialStep,
  savedBusinessType,
  savedBusinessSubtype,
  savedSettings,
}: SetupWizardProps) {
  return (
    <RebuildSetupWizard
      orgName={orgName}
      initialStep={initialStep}
      savedBusinessType={savedBusinessType}
      savedBusinessSubtype={savedBusinessSubtype}
      savedSettings={savedSettings}
    />
  );
}
