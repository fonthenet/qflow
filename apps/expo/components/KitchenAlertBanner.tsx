/**
 * KitchenAlertBanner — operator-wide "order ready" toast.
 *
 * Subscribes to public.notifications realtime for the current org and
 * surfaces a top-of-screen banner whenever the kitchen marks a ticket
 * ready: "Order ready: Table 1 — Salade mixte ×1, Chorba ×1". Dedupes
 * by ticket_id within 10 s so the same ready event from Station + Expo
 * doesn't double-toast.
 *
 * Restaurant-only + cloud-only — silent in non-food orgs and in local
 * Station mode.
 *
 * Renders an absolute-positioned banner on top of the operator Tabs.
 * RTL-safe (uses logical alignment + i18n labels for FR/AR/EN).
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/use-org';
import { useBusinessCategory } from '@/lib/use-business-category';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import { colors, fontSize, spacing, borderRadius } from '@/lib/theme';

interface ReadyAlert {
  id: string;
  ticket_id: string;
  ticket_number?: string | null;
  table_label?: string | null;
  party_size?: number | string | null;
  customer_name?: string | null;
  items: { name: string; qty: number }[];
}

const DISMISS_MS = 6000;
const DEDUPE_MS = 10_000;

export default function KitchenAlertBanner() {
  const { t, i18n } = useTranslation();
  const { orgId, officeIds } = useOrg();
  const { isRestaurantVertical } = useBusinessCategory(orgId);
  const localMode = useLocalConnectionStore((s) => s.mode);
  const isLocal = localMode === 'local';
  const [alert, setAlert] = useState<ReadyAlert | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slide = useRef(new Animated.Value(-120)).current;
  const recentRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!orgId || isLocal || !isRestaurantVertical) return;
    const channel = supabase
      .channel(`kitchen-alert-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload: any) => {
          try {
            const row = payload?.new ?? payload?.record;
            if (!row || row.type !== 'kitchen_ready') return;
            const inner = row.payload ?? {};
            // Filter on org + office to avoid cross-tenant leakage.
            if (inner.organization_id && inner.organization_id !== orgId) return;
            if (inner.office_id && officeIds && !officeIds.includes(inner.office_id)) return;
            const ticketId = inner.ticket_id || row.ticket_id;
            if (!ticketId) return;
            // Dedupe rapid duplicates from concurrent Station + Expo writes.
            const now = Date.now();
            const last = recentRef.current.get(ticketId) ?? 0;
            if (now - last < DEDUPE_MS) return;
            recentRef.current.set(ticketId, now);
            for (const [k, ts] of recentRef.current) {
              if (now - ts > 60_000) recentRef.current.delete(k);
            }
            setAlert({
              id: row.id,
              ticket_id: ticketId,
              ticket_number: inner.ticket_number,
              table_label: inner.table_label,
              party_size: inner.party_size,
              customer_name: inner.customer_name,
              items: Array.isArray(inner.items) ? inner.items : [],
            });
          } catch { /* swallow */ }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, isLocal, isRestaurantVertical, officeIds]);

  // Slide in / auto-dismiss
  useEffect(() => {
    if (!alert) return;
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => dismiss(), DISMISS_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id]);

  const dismiss = () => {
    Animated.timing(slide, { toValue: -160, duration: 220, useNativeDriver: true }).start(() => {
      setAlert(null);
    });
  };

  if (!alert) return null;

  const lang = (i18n.language || 'en').slice(0, 2);
  const tableLine = alert.table_label
    ? lang === 'fr'
      ? `Table ${alert.table_label}`
      : lang === 'ar'
        ? `طاولة ${alert.table_label}`
        : `Table ${alert.table_label}`
    : alert.ticket_number || '';
  const headline =
    lang === 'fr' ? `Commande prête : ${tableLine}`
      : lang === 'ar' ? `الطلب جاهز: ${tableLine}`
      : `Order ready: ${tableLine}`;
  const itemsLine = alert.items
    .map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`)
    .join(', ');

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: slide }] }]} pointerEvents="box-none">
      <Pressable onPress={dismiss} style={styles.banner} accessibilityRole="alert" accessibilityLabel={`${headline}. ${itemsLine}`}>
        <View style={styles.iconBubble}>
          <Ionicons name="restaurant" size={20} color="#fff" />
        </View>
        <View style={styles.text}>
          <Text style={styles.headline} numberOfLines={1}>{headline}</Text>
          {itemsLine ? (
            <Text style={styles.items} numberOfLines={2}>{itemsLine}</Text>
          ) : null}
        </View>
        <Ionicons name="close" size={18} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.lg + 24, // status-bar safe area approx
    paddingHorizontal: spacing.md,
    zIndex: 9999,
    elevation: 12,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#16a34a',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  headline: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  items: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: fontSize.sm,
    marginTop: 2,
  },
});

// Keep TS happy on `colors` import even if unused above.
void colors;
void useTranslation;
