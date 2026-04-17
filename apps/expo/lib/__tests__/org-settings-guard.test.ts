/**
 * Static guard: prevents org-settings drift.
 *
 * Every org-level setting in QFlo is registered in
 * `packages/shared/src/org-settings.ts`. Clients read/write through
 * `readAllOrgSettings` / `writeOrgSetting` — NOT by hand-rolling
 * `supabase.from('organizations').update({ settings: {...} })`.
 *
 * If a client bypasses the registry it silently writes to a key that
 * Station and web don't read, creating drift. This test scans the mobile
 * app source for forbidden patterns and fails CI if found.
 *
 * Exempt file: the mobile AdminSettings panel still uses legacy direct
 * writes (it works and we don't want a big refactor to risk regression).
 * It's explicitly allowlisted below; new code must use the registry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const APP_ROOT = join(__dirname, '..', '..');
const ROOTS = [
  join(APP_ROOT, 'app'),
  join(APP_ROOT, 'lib'),
  join(APP_ROOT, 'components'),
];

/**
 * Files that pre-date the shared registry and still call
 * `supabase.from('organizations').update(...)` directly. These are grand-
 * fathered in — new files must not be added to this list. If something
 * here ever gets refactored to use `writeOrgSetting`, remove its entry.
 */
const ALLOWLIST = new Set<string>([
  // Uses the existing updateSetting / updateSettingsJson helpers internally.
  // Verified to write to canonical Station keys as of this commit, but should
  // eventually migrate to `@qflo/shared`'s writeOrgSetting for stronger
  // drift resistance.
  'components/AdminSettings.tsx',
]);

// Patterns that indicate a raw write to `organizations` settings / columns.
// Matches multi-line too (the actual writes often span several lines).
const FORBIDDEN_PATTERNS: { label: string; re: RegExp }[] = [
  {
    label: "supabase.from('organizations').update(...) with { settings: ... }",
    re: /from\(\s*['"]organizations['"]\s*\)[\s\S]{0,200}?\.update\(\s*\{\s*settings:/,
  },
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('Org settings drift guard', () => {
  it('no raw writes to organizations.settings outside the shared helpers', () => {
    const files = ROOTS.flatMap((root) => walk(root));
    const offenders: { file: string; label: string; snippet: string }[] = [];

    for (const full of files) {
      const rel = relative(APP_ROOT, full).replace(/\\/g, '/');
      if (ALLOWLIST.has(rel)) continue;
      const content = readFileSync(full, 'utf8');
      for (const { label, re } of FORBIDDEN_PATTERNS) {
        const m = content.match(re);
        if (m) {
          const idx = content.indexOf(m[0]);
          const line = content.slice(0, idx).split('\n').length;
          offenders.push({
            file: `${rel}:${line}`,
            label,
            snippet: m[0].replace(/\s+/g, ' ').slice(0, 140) + '…',
          });
        }
      }
    }

    if (offenders.length > 0) {
      const msg = [
        '',
        '❌ Raw writes to organizations.settings detected outside the shared registry.',
        '   These bypass `@qflo/shared`\'s writeOrgSetting and create drift — the',
        '   setting won\'t round-trip through Station, web, and mobile consistently.',
        '',
        '   Fix: register the setting in packages/shared/src/org-settings.ts and call',
        '   writeOrgSetting(supabase, orgId, key, value) instead of a raw .update().',
        '',
        '   Offenders:',
        ...offenders.map((o) => `     ${o.file}  [${o.label}]\n       ${o.snippet}`),
        '',
      ].join('\n');
      throw new Error(msg);
    }

    expect(offenders).toEqual([]);
  });
});
