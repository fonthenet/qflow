/**
 * Native rider portal — opened via universal link
 * `qflo.net/rider/<ticketId>/<token>` when the app is installed.
 * Same UX shape as the web rider portal but with one critical
 * upgrade: GPS streams in the BACKGROUND. When the rider taps
 * "Open Maps" or locks their phone, the heartbeat keeps firing via
 * expo-task-manager — so the customer's tracking page stays live
 * the entire run, not just while the rider is staring at this screen.
 *
 * Auth is the same stateless HMAC token the web portal uses (no
 * login required). The token is verified server-side on every
 * heartbeat / arrived / delivered call.
 *
 * Screen layout (mirrors the web portal):
 *   - Status header — order id + GPS pill (LIVE / FOREGROUND / OFF)
 *   - Customer card — name, phone (tap-to-call), address
 *   - Drop-off card — address + Navigate CTA (opens native Maps app)
 *   - Action buttons — ARRIVED, DELIVERED
 *   - Quiet footer once delivered
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  postArrived,
  postDelivered,
} from '@/lib/rider-api';
import {
  startRiderLocationStream,
  stopRiderLocationStream,
  isRiderLocationStreaming,
} from '@/lib/rider-location-task';
import { API_BASE_URL } from '@/lib/config';

interface TicketDetails {
  id: string;
  ticket_number: string;
  customer_data: { name?: string; phone?: string } | null;
  delivery_address: { street?: string; city?: string; lat?: number; lng?: number; instructions?: string } | null;
  notes: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  organization_name?: string | null;
}

type GeoState = 'requesting' | 'live' | 'foreground' | 'denied' | 'off';

export default function RiderScreen() {
  const params = useLocalSearchParams<{ id: string; token: string }>();
  const ticketId = String(params.id ?? '');
  const token = String(params.token ?? '');
  const router = useRouter();

  const [ticket, setTicket] = useState<TicketDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoState>('requesting');
  const [busy, setBusy] = useState<'arrived' | 'delivered' | null>(null);

  // ── Fetch the ticket details on mount ──
  // We hit the same /api/rider/details endpoint the web portal uses
  // (or fall back to /api/tickets/:id if the dedicated endpoint
  // doesn't exist yet). The token verifies server-side.
  useEffect(() => {
    let cancelled = false;
    if (!ticketId || !token) {
      setError('Missing ticket id or token.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        // Lightweight detail fetch — the rider portal page already
        // server-renders these fields. We re-fetch via a public
        // endpoint that takes the rider token. If unavailable, we
        // still let ARRIVED/DELIVERED work (they don't need ticket
        // detail to fire) and just show "Order #ID" in the UI.
        const r = await fetch(`${API_BASE_URL}/api/rider/details`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId, token }),
        });
        if (cancelled) return;
        const data = await r.json().catch(() => ({}));
        if (r.ok && data?.ticket) {
          setTicket(data.ticket);
        } else if (r.status === 401) {
          setError('This delivery link is invalid or expired.');
        } else {
          // No detail endpoint — render in minimal mode.
          setTicket({
            id: ticketId,
            ticket_number: ticketId.slice(0, 8),
            customer_data: null,
            delivery_address: null,
            notes: null,
            arrived_at: null,
            delivered_at: null,
          });
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? 'Failed to load delivery.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticketId, token]);

  // ── Start GPS streaming on mount, stop on unmount or delivered ──
  useEffect(() => {
    if (!ticketId || !token) return;
    if (ticket?.delivered_at) {
      // Already delivered — never start.
      setGeo('off');
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await startRiderLocationStream({ ticketId, token });
      if (cancelled) return;
      if (!r.ok) {
        setGeo(r.permission === 'denied' ? 'denied' : 'off');
        return;
      }
      setGeo(r.permission === 'granted' ? 'live' : 'foreground');
    })();
    return () => {
      cancelled = true;
      // Don't stop on unmount — the rider may navigate away to Maps
      // and return; we want the stream alive across foreground/back-
      // ground transitions. The task only stops when:
      //   1. server signals { stopped: true } (delivered/cancelled)
      //   2. the rider taps DELIVERED (handler stops it explicitly)
      //   3. they manually toggle the GPS pill off (future feature)
    };
  }, [ticketId, token, ticket?.delivered_at]);

  // ── Periodic re-check of stream status (in case the OS killed it) ──
  useEffect(() => {
    const t = setInterval(async () => {
      const running = await isRiderLocationStreaming();
      setGeo((prev) => {
        if (ticket?.delivered_at) return 'off';
        if (running) return prev === 'foreground' ? 'foreground' : 'live';
        if (prev === 'denied') return 'denied';
        return 'off';
      });
    }, 8_000);
    return () => clearInterval(t);
  }, [ticket?.delivered_at]);

  const isDelivered = Boolean(ticket?.delivered_at);
  const hasArrived = Boolean(ticket?.arrived_at);

  const customerName = ticket?.customer_data?.name ?? null;
  const customerPhone = ticket?.customer_data?.phone ?? null;
  const address = ticket?.delivery_address?.street ?? null;
  const addressCity = ticket?.delivery_address?.city ?? null;
  const addressInstructions = ticket?.delivery_address?.instructions ?? null;
  const destLat = ticket?.delivery_address?.lat ?? null;
  const destLng = ticket?.delivery_address?.lng ?? null;
  const note = ticket?.notes ?? null;

  // Universal Maps deeplink — Android opens GMaps, iOS opens Apple
  // Maps, both honour `dir_action=navigate` so the user lands in
  // turn-by-turn mode immediately.
  const mapsUrl = useMemo(() => {
    if (destLat == null || destLng == null) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&dir_action=navigate`;
  }, [destLat, destLng]);

  // ── Action handlers ──
  const onArrived = async () => {
    if (busy || hasArrived || isDelivered) return;
    setBusy('arrived');
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const r = await postArrived(ticketId, token);
      if (!r.ok) throw new Error(r.error ?? 'arrived failed');
      // Optimistic local update so the UI flips immediately.
      setTicket((t) => t ? { ...t, arrived_at: r.arrived_at ?? new Date().toISOString() } : t);
    } catch (e: any) {
      Alert.alert('Could not mark as Arrived', e?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const onDelivered = async () => {
    if (busy || isDelivered) return;
    Alert.alert(
      'Mark as Delivered?',
      'This will end the run and stop sharing your location with the customer.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delivered',
          style: 'default',
          onPress: async () => {
            setBusy('delivered');
            try {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              const r = await postDelivered(ticketId, token);
              if (!r.ok) throw new Error(r.error ?? 'delivered failed');
              setTicket((t) => t ? { ...t, delivered_at: r.delivered_at ?? new Date().toISOString() } : t);
              await stopRiderLocationStream();
              setGeo('off');
            } catch (e: any) {
              Alert.alert('Could not mark as Delivered', e?.message ?? 'Please try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }
  if (error || !ticket) {
    return (
      <View style={[styles.screen, styles.center, { padding: 24 }]}>
        <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
        <Text style={styles.errorTitle}>Can't open delivery</Text>
        <Text style={styles.errorBody}>{error ?? 'Ticket not found.'}</Text>
        <Pressable onPress={() => router.back()} style={styles.errorBtn}>
          <Text style={styles.errorBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header — order number + GPS pill */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerEyebrow}>Delivery</Text>
            <Text style={styles.headerTitle}>{ticket.organization_name ?? 'Run'}</Text>
            <Text style={styles.headerTicket}>#{ticket.ticket_number}</Text>
          </View>
          <GeoPill state={geo} />
        </View>

        {/* Customer card */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Customer</Text>
          <Text style={styles.customerName}>{customerName ?? '—'}</Text>
          {customerPhone ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${customerPhone}`)}
              style={styles.phoneRow}
            >
              <Ionicons name="call" size={16} color="#16a34a" />
              <Text style={styles.phoneText}>{customerPhone}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Drop-off card */}
        {address ? (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>Drop-off</Text>
                <Text style={styles.addressText}>{address}</Text>
                {(addressCity || addressInstructions) ? (
                  <Text style={styles.addressSub}>
                    {addressCity ?? ''}{addressCity && addressInstructions ? ' · ' : ''}{addressInstructions ?? ''}
                  </Text>
                ) : null}
              </View>
              {mapsUrl ? (
                <Pressable
                  onPress={() => Linking.openURL(mapsUrl)}
                  style={styles.navigateBtn}
                  accessibilityLabel="Navigate"
                >
                  <Ionicons name="navigate" size={18} color="#fff" />
                  <Text style={styles.navigateText}>Navigate</Text>
                </Pressable>
              ) : null}
            </View>
            {note ? (
              <View style={styles.noteBox}>
                <Ionicons name="document-text-outline" size={14} color="#64748b" />
                <Text style={styles.noteText}>{note}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Action buttons */}
        {!isDelivered ? (
          <View style={{ gap: 10, marginTop: 8 }}>
            {!hasArrived ? (
              <Pressable
                onPress={onArrived}
                disabled={busy !== null}
                style={[styles.bigBtn, styles.btnArrived, busy === 'arrived' && styles.btnBusy]}
              >
                {busy === 'arrived' ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="home" size={20} color="#fff" />
                    <Text style={styles.bigBtnText}>I've Arrived</Text>
                  </>
                )}
              </Pressable>
            ) : null}
            <Pressable
              onPress={onDelivered}
              disabled={busy !== null}
              style={[styles.bigBtn, styles.btnDelivered, busy === 'delivered' && styles.btnBusy]}
            >
              {busy === 'delivered' ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.bigBtnText}>Mark as Delivered</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={[styles.card, styles.deliveredCard]}>
            <Ionicons name="checkmark-circle" size={32} color="#16a34a" />
            <Text style={styles.deliveredTitle}>Order delivered</Text>
            <Text style={styles.deliveredSub}>Customer has been notified. You can close this screen.</Text>
          </View>
        )}

        <Text style={styles.footer}>
          Live location streams in the background — even when your phone is locked.
          {'\n'}Stops automatically once the order is delivered.
        </Text>
      </ScrollView>
    </View>
  );
}

function GeoPill({ state }: { state: GeoState }) {
  const cfg = (() => {
    switch (state) {
      case 'live':       return { dot: '#22c55e', text: 'LIVE',         tone: '#dcfce7', fg: '#15803d' };
      case 'foreground': return { dot: '#f59e0b', text: 'FOREGROUND',   tone: '#fef3c7', fg: '#b45309' };
      case 'requesting': return { dot: '#f59e0b', text: 'LOCATING…',    tone: '#fef3c7', fg: '#b45309' };
      case 'denied':     return { dot: '#ef4444', text: 'GPS BLOCKED',  tone: '#fee2e2', fg: '#b91c1c' };
      case 'off':        return { dot: '#94a3b8', text: 'OFF',          tone: '#f1f5f9', fg: '#64748b' };
    }
  })();
  return (
    <View style={[styles.geoPill, { backgroundColor: cfg.tone }]}>
      <View style={[styles.geoDot, { backgroundColor: cfg.dot }]} />
      <Text style={[styles.geoText, { color: cfg.fg }]}>{cfg.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 14, paddingBottom: 36, gap: 10 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Platform.OS === 'ios' ? 50 : 24,
    paddingHorizontal: 4,
    gap: 12,
  },
  headerEyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
    color: '#64748b', textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: 22, fontWeight: '700', color: '#0f172a', marginTop: 2,
  },
  headerTicket: {
    fontSize: 13, color: '#64748b', marginTop: 2, fontVariant: ['tabular-nums'],
  },

  geoPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  geoDot: { width: 8, height: 8, borderRadius: 4 },
  geoText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  cardLabel: {
    fontSize: 10, fontWeight: '700', color: '#94a3b8',
    letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4,
  },
  customerName: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  phoneText: { fontSize: 14, color: '#15803d', fontWeight: '600' },

  addressText: { fontSize: 14, fontWeight: '600', color: '#0f172a', lineHeight: 20 },
  addressSub: { fontSize: 12, color: '#64748b', marginTop: 2 },

  noteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#f8fafc',
  },
  noteText: { fontSize: 12, color: '#475569', fontStyle: 'italic', flex: 1 },

  navigateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999,
    backgroundColor: '#0f172a', flexShrink: 0,
    shadowColor: '#0f172a', shadowOpacity: 0.24, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12,
    elevation: 4,
  },
  navigateText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.2 },

  bigBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderRadius: 14,
    shadowColor: '#0f172a', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10,
    elevation: 3,
  },
  btnArrived:   { backgroundColor: '#3b82f6' },
  btnDelivered: { backgroundColor: '#16a34a' },
  btnBusy:      { opacity: 0.7 },
  bigBtnText: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.2 },

  deliveredCard: { alignItems: 'center', gap: 6, padding: 22 },
  deliveredTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  deliveredSub: { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 18 },

  footer: { fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 16, marginTop: 14 },

  errorTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  errorBody: { fontSize: 13, color: '#475569', textAlign: 'center', marginTop: 6 },
  errorBtn: {
    marginTop: 18, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999,
    backgroundColor: '#0f172a',
  },
  errorBtnText: { color: '#fff', fontWeight: '700' },
});
