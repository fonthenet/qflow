/**
 * Static guard: prevents regressions of the "Session fetch failed: 401" bug.
 *
 * The Station's `/api/station/*` endpoints require an X-Station-Token header.
 * Only `station-client.ts` knows how to fetch and attach that token (via its
 * `authedFetch` helper). Any other file that calls `/api/station/*` directly
 * with `fetch()` bypasses the auth layer and will 401 at runtime.
 *
 * This test fails CI if such a raw fetch sneaks in. If you need to add a new
 * Station endpoint, add a function to `station-client.ts` that uses
 * `authedFetch`, and call that from your screen/hook instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const LIB_DIR = join(__dirname, '..');
const APP_DIR = join(__dirname, '..', '..', 'app');
const COMPONENTS_DIR = join(__dirname, '..', '..', 'components');

// The single file that is *allowed* to talk to /api/station/* with raw fetch,
// because it implements the auth wrapper itself.
const ALLOWED_FILES = new Set([
  'lib/station-client.ts',
]);

// Match patterns like:
//   fetch(`${baseUrl}/api/station/foo`
//   fetch(baseUrl + '/api/station/foo'
//   fetch('http://x/api/station/foo'
// Anything that passes a string/template containing `/api/station/` to fetch().
const FORBIDDEN_PATTERN = /\bfetch\s*\(\s*[^)]*\/api\/station\//;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('Station API auth guard', () => {
  it('only station-client.ts may call /api/station/* with raw fetch', () => {
    const appRoot = join(__dirname, '..', '..');
    const files = [
      ...walk(LIB_DIR),
      ...walk(APP_DIR),
      ...walk(COMPONENTS_DIR),
    ];

    const offenders: { file: string; line: number; text: string }[] = [];

    for (const full of files) {
      const rel = relative(appRoot, full).replace(/\\/g, '/');
      if (ALLOWED_FILES.has(rel)) continue;

      const content = readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Skip comments/doc-strings referencing the path for documentation.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (FORBIDDEN_PATTERN.test(line)) {
          offenders.push({ file: rel, line: idx + 1, text: line.trim() });
        }
      });
    }

    if (offenders.length > 0) {
      const msg = [
        '',
        '❌ Raw fetch() to /api/station/* found outside lib/station-client.ts.',
        '   These requests will 401 because they do not send X-Station-Token.',
        '',
        '   Fix: add/use a function from lib/station-client.ts (which routes',
        '   through authedFetch and handles token fetch + retry).',
        '',
        '   Offenders:',
        ...offenders.map((o) => `     ${o.file}:${o.line}  ${o.text}`),
        '',
      ].join('\n');
      throw new Error(msg);
    }

    expect(offenders).toEqual([]);
  });
});
