'use client';

/**
 * country-hooks.ts — React client hooks for country/vertical data.
 *
 * Separated from country.ts so that the pure server-safe helpers in country.ts
 * can be imported by Server Components without triggering the
 * "You're importing a component that needs useState" error.
 *
 * Import from this file in Client Components only.
 */

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  getCountryConfig,
  getVertical,
  type CountryConfig,
  type VerticalsRow,
  _countryCache,
} from './country';

export type { CountryConfig, VerticalsRow };

/**
 * React hook — fetch a country config by ISO code.
 * Safe to call in client components; memoised per code within the session.
 */
export function useCountryConfig(code: string | null | undefined): {
  data: CountryConfig | null;
  loading: boolean;
} {
  const [data, setData] = useState<CountryConfig | null>(null);
  const [loading, setLoading] = useState(Boolean(code));

  useEffect(() => {
    if (!code) {
      setData(null);
      setLoading(false);
      return;
    }
    const upper = code.trim().toUpperCase();
    // Check module cache first (populated by server pass or earlier client fetch)
    if (_countryCache.has(upper)) {
      setData(_countryCache.get(upper)!);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    setLoading(true);
    getCountryConfig(supabase, upper).then((c) => {
      setData(c);
      setLoading(false);
    });
  }, [code]);

  return { data, loading };
}

/**
 * React hook — fetch the country config for the current org.
 * Reads org from the authenticated session.
 */
export function useOrgCountry(): {
  data: CountryConfig | null;
  loading: boolean;
} {
  const [data, setData] = useState<CountryConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Fetch the org country via staff_members join
      const { data: staffRow } = await supabase
        .from('staff_members')
        .select('organizations(country)')
        .eq('user_id', user.id)
        .single();

      const orgCountry = (staffRow?.organizations as any)?.country as string | null;
      if (!orgCountry) {
        setLoading(false);
        return;
      }

      const config = await getCountryConfig(supabase, orgCountry);
      setData(config);
      setLoading(false);
    })();
  }, []);

  return { data, loading };
}

/**
 * React hook — fetch the vertical row for the current org.
 */
export function useOrgVertical(): {
  data: VerticalsRow | null;
  loading: boolean;
} {
  const [data, setData] = useState<VerticalsRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: staffRow } = await supabase
        .from('staff_members')
        .select('organizations(vertical)')
        .eq('user_id', user.id)
        .single();

      const slug = (staffRow?.organizations as any)?.vertical as string | null;
      if (!slug) {
        setLoading(false);
        return;
      }

      const vertical = await getVertical(supabase, slug);
      setData(vertical);
      setLoading(false);
    })();
  }, []);

  return { data, loading };
}
