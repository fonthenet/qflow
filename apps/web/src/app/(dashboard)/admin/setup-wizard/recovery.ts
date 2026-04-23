/**
 * Broken-state recovery helpers for the setup wizard.
 *
 * Extracted from page.tsx so the logic can be unit-tested without
 * mocking Next.js or Supabase.
 */

export type RecoveryResult =
  | { shouldRecover: false; reason: string }
  | { shouldRecover: true; fixedSettings: Record<string, unknown> };

/**
 * Determines whether the broken-state recovery block should fire and,
 * if so, returns the corrected settings blob.
 *
 * Recovery is ONLY valid for the portal-preview path:
 *   1. lifecycleState === 'template_confirmed'   — settings claim confirmed
 *   2. officeCount === 0                          — but no offices exist
 *   3. platform_trial_template_id is a truthy string — trial keys are present
 *
 * Station-created orgs skip the preview step entirely and therefore never
 * have platform_trial_* keys.  If those keys are absent we must NOT fire
 * recovery — the org is either Station-created with a legitimately deleted
 * office, or in a completely unrelated broken state.
 *
 * Belt-and-suspenders: any resolved value that is still undefined is
 * written as null so the settings blob stays clean (no undefined entries).
 */
export function buildBrokenStateRecovery(
  settings: Record<string, unknown>,
  orgName: string,
  orgTimezone: string | null | undefined,
  lifecycleState: string,
  officeCount: number,
): RecoveryResult {
  // Gate 1: is the org in the zombie confirmed+no-offices state?
  if (lifecycleState !== 'template_confirmed' || officeCount !== 0) {
    return {
      shouldRecover: false,
      reason: 'not in zombie state (lifecycleState or officeCount mismatch)',
    };
  }

  // Gate 2: trial keys must actually exist — portal preview path only.
  const trialTemplateId = settings.platform_trial_template_id;
  if (typeof trialTemplateId !== 'string' || trialTemplateId.trim() === '') {
    return {
      shouldRecover: false,
      reason:
        'platform_trial_template_id is absent — org was not created via portal template preview ' +
        '(likely Station-created). Recovery skipped to avoid corrupting settings.',
    };
  }

  // Helper: resolve a value; return null instead of undefined to keep the
  // settings blob free of undefined entries.
  function resolve(...candidates: unknown[]): unknown {
    for (const c of candidates) {
      if (c !== undefined && c !== null && c !== '') return c;
    }
    return null;
  }

  const fixedSettings: Record<string, unknown> = { ...settings };

  fixedSettings.platform_template_state = 'template_trial_state';

  fixedSettings.platform_trial_template_id = resolve(
    settings.platform_template_id,
    settings.platform_trial_template_id,
  );
  fixedSettings.platform_trial_template_version = resolve(
    settings.platform_template_version,
    settings.platform_trial_template_version,
  );
  fixedSettings.platform_trial_vertical = resolve(
    settings.platform_vertical,
    settings.platform_trial_vertical,
  );
  fixedSettings.platform_trial_operating_model = resolve(
    settings.platform_operating_model,
    settings.platform_trial_operating_model,
  );
  fixedSettings.platform_trial_branch_type = resolve(
    settings.platform_branch_type,
    settings.platform_trial_branch_type,
  );
  fixedSettings.platform_trial_office_name = resolve(
    settings.platform_trial_office_name,
    orgName,
  );
  // Fall back to org timezone then UTC — never hardcode a regional default.
  fixedSettings.platform_trial_timezone = resolve(
    settings.platform_trial_timezone,
    orgTimezone,
    'UTC',
  );
  fixedSettings.platform_trial_seed_priorities = true;

  // Clear the confirmed marker that triggered this branch.
  delete fixedSettings.platform_template_confirmed_at;

  return { shouldRecover: true, fixedSettings };
}
