import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOfficePublicSlug } from '@/lib/office-links';
import { checkRateLimit, publicLimiter } from '@/lib/rate-limit';
import { sanitizeString } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Public directory search — returns offices belonging to organizations that
 * have `settings.listed_in_directory === true`, optionally filtered by a
 * fuzzy query matching org name / office name / address / category /
 * department / service.
 *
 * Matching is intentionally forgiving:
 *   - case + diacritics normalized ("dzair" matches "Dzaïr")
 *   - matches if the query is a prefix of any word in the haystack
 *     ("gas" → "Gastro Clinic", "hair" → "Hair Salon")
 *   - matches if the query letters form an acronym of the name tokens
 *     ("dz" → "Dzair Zone", "bmw" → "Brahimi Motor Works")
 *   - matches if the query is a substring (safety net)
 *   - matches if ALL multi-word query tokens hit one of the above
 *     ("paris hair" still matches "Hair Salon Paris")
 *
 * Each candidate gets a relevance score and results are ranked by it.
 */
export async function GET(request: NextRequest) {
  const blocked = await checkRateLimit(request, publicLimiter);
  if (blocked) return blocked;

  const rawQ = request.nextUrl.searchParams.get('q') ?? '';
  const q = normalize(sanitizeString(rawQ, 80));

  const supabase = createAdminClient();

  const { data: orgs, error: orgsError } = await supabase
    .from('organizations')
    .select('id, name, logo_url, settings')
    .limit(500);

  if (orgsError) {
    return NextResponse.json({ error: orgsError.message }, { status: 500 });
  }

  // Default: businesses are listed in the public directory unless an admin
  // has explicitly opted out by setting `listed_in_directory: false`.
  const listedOrgs = (orgs ?? []).filter((o: any) => {
    const s = (o.settings ?? {}) as Record<string, any>;
    return s.listed_in_directory !== false;
  });

  if (listedOrgs.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const orgIds = listedOrgs.map((o: any) => o.id);

  // Fetch ALL offices for listed orgs (don't filter by is_active — a newly
  // onboarded business may not have flipped the switch yet, and we still
  // want it discoverable).
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, address, organization_id, settings, is_active')
    .in('organization_id', orgIds);

  const officeList = offices ?? [];
  const officeIds = officeList.map((o: any) => o.id);

  // Fetch departments + services only for offices we actually have. Used to
  // enrich the searchable haystack with keywords like "dental", "haircut".
  const { data: depts } = officeIds.length
    ? await supabase
        .from('departments')
        .select('id, name, office_id, services(id, name)')
        .in('office_id', officeIds)
        .eq('is_active', true)
    : { data: [] as any[] };

  // Index dept/service strings per office for keyword matching
  const deptStringsByOffice = new Map<string, string[]>();
  for (const d of depts ?? []) {
    const arr = deptStringsByOffice.get(d.office_id) ?? [];
    if (d.name) arr.push(String(d.name));
    for (const s of (d as any).services ?? []) {
      if (s?.name) arr.push(String(s.name));
    }
    deptStringsByOffice.set(d.office_id, arr);
  }

  type Candidate = {
    score: number;
    payload: {
      orgId: string;
      orgName: string;
      logoUrl: string | null;
      category: string | null;
      officeId: string;
      officeName: string;
      address: string | null;
      kioskSlug: string;
    };
  };

  const orgById = new Map(listedOrgs.map((o: any) => [o.id, o]));
  const candidates: Candidate[] = [];

  for (const office of officeList) {
    const org = orgById.get(office.organization_id);
    if (!org) continue;
    const orgSettings = ((org as any).settings ?? {}) as Record<string, any>;
    const category = (orgSettings.business_category ?? '') as string;
    const extras = deptStringsByOffice.get(office.id) ?? [];

    const primary = [(org as any).name, office.name].filter(Boolean).join(' ');
    const secondary = [office.address ?? '', category, ...extras]
      .filter(Boolean)
      .join(' ');

    const score = q ? scoreMatch(q, primary, secondary) : 1; // empty query = show everything
    if (score > 0) {
      candidates.push({
        score,
        payload: {
          orgId: (org as any).id,
          orgName: (org as any).name,
          logoUrl: (org as any).logo_url ?? null,
          category: category || null,
          officeId: office.id,
          officeName: office.name,
          address: office.address ?? null,
          kioskSlug: getOfficePublicSlug(office),
        },
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return NextResponse.json({
    results: candidates.slice(0, 50).map((c) => c.payload),
  });
}

// ---------------------------------------------------------------------------
// Fuzzy matching helpers
// ---------------------------------------------------------------------------

/** Lowercase + strip diacritics + collapse whitespace. */
function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a string into word tokens (alphanumeric runs). */
function tokens(str: string): string[] {
  return str.split(/[^a-z0-9]+/i).filter(Boolean);
}

/**
 * Score a single haystack against the query.
 *   40 — query is a prefix of the primary string ("dz..." starts "dzair...")
 *   30 — query is an acronym of primary tokens ("dz" → "Dzair Zone")
 *   25 — every query token is a prefix of some primary token
 *   15 — query substring in primary
 *   10 — every query token is a prefix of some secondary token
 *    5 — query substring in secondary
 *    0 — no match
 */
function scoreMatch(q: string, primaryRaw: string, secondaryRaw: string): number {
  const primary = normalize(primaryRaw);
  const secondary = normalize(secondaryRaw);
  const qTokens = tokens(q);
  if (qTokens.length === 0) return 0;

  const primaryTokens = tokens(primary);
  const secondaryTokens = tokens(secondary);

  // 1. Full-query prefix on primary
  if (primary.startsWith(q)) return 40;

  // 2. Acronym on primary tokens: every letter of q matches the start of a
  //    consecutive primary token.
  if (q.length >= 2 && q.length <= primaryTokens.length) {
    let i = 0;
    let ok = true;
    for (const ch of q.replace(/\s+/g, '')) {
      // find next primary token whose first char matches ch
      while (i < primaryTokens.length && primaryTokens[i][0] !== ch) i++;
      if (i >= primaryTokens.length) {
        ok = false;
        break;
      }
      i++;
    }
    if (ok) return 30;
  }

  // 3. Every query token is a prefix of some primary token
  const allPrimaryPrefix = qTokens.every((qt) =>
    primaryTokens.some((pt) => pt.startsWith(qt)),
  );
  if (allPrimaryPrefix) return 25;

  // 4. Substring in primary
  if (primary.includes(q)) return 15;

  // 5. Every query token is a prefix of some secondary token
  const allSecondaryPrefix = qTokens.every((qt) =>
    secondaryTokens.some((st) => st.startsWith(qt)),
  );
  if (allSecondaryPrefix) return 10;

  // 6. Substring in secondary
  if (secondary.includes(q)) return 5;

  return 0;
}
