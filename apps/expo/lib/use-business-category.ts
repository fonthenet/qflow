/**
 * useBusinessCategory
 *
 * Lightweight hook that fetches `organizations.settings.business_category`
 * for the current org and caches it in memory. Used by the operator
 * tab bar to gate restaurant-only screens (Kitchen Display) and by any
 * component that needs to branch on vertical without re-fetching.
 *
 * Cloud-only — local Station mode currently doesn't expose the org row;
 * we return null in that case (the gated tab simply hides, which is the
 * desired behaviour for v1 since the KDS is cloud-only).
 */

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const RESTAURANT_CATEGORIES = new Set(['restaurant', 'cafe']);

const cache = new Map<string, string | null>();

export function useBusinessCategory(orgId: string | null): {
  category: string | null;
  isRestaurantVertical: boolean;
  loading: boolean;
} {
  const [category, setCategory] = useState<string | null>(orgId ? cache.get(orgId) ?? null : null);
  const [loading, setLoading] = useState<boolean>(orgId ? !cache.has(orgId) : false);

  useEffect(() => {
    if (!orgId) {
      setCategory(null);
      setLoading(false);
      return;
    }
    if (cache.has(orgId)) {
      setCategory(cache.get(orgId) ?? null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        const cat = ((data?.settings as any)?.business_category ?? null) as string | null;
        cache.set(orgId, cat);
        setCategory(cat);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [orgId]);

  return {
    category,
    isRestaurantVertical: !!category && RESTAURANT_CATEGORIES.has(category),
    loading,
  };
}
