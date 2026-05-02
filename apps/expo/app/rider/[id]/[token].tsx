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
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import {
  postAccept,
  postArrived,
  postDecline,
  postDelivered,
  postPickup,
  postRegisterPush,
} from '@/lib/rider-api';
import {
  startRiderLocationStream,
  stopRiderLocationStream,
  isRiderLocationStreaming,
} from '@/lib/rider-location-task';
import { API_BASE_URL } from '@/lib/config';
import { RiderRouteMap } from '@/components/RiderRouteMap';
import { haversineMeters, formatDistance, formatEta } from '@/lib/rider-eta';

interface OrderItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  note?: string | null;
}

interface PickupInfo {
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
}

interface TicketDetails {
  id: string;
  ticket_number: string;
  status?: string | null;
  customer_data: { name?: string; phone?: string } | null;
  delivery_address: { street?: string; city?: string; lat?: number; lng?: number; instructions?: string } | null;
  notes: string | null;
  dispatched_at?: string | null;
  picked_up_at?: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  /** null when the operator has unassigned the rider (e.g. via Station). */
  assigned_rider_id?: string | null;
  organization_name?: string | null;
  pickup?: PickupInfo | null;
  items?: OrderItem[];
  order_total?: number;
}

/**
 * Lifecycle stage derived from the timestamp quad on the ticket.
 *   pending          → assigned, not yet accepted (no dispatched_at)
 *   goingToPickup    → accepted, no picked_up_at — drive to restaurant
 *   goingToCustomer  → picked up, no arrived_at — drive to customer
 *   atDoor           → at drop-off (arrived_at, no delivered_at)
 *   delivered        → terminal
 *   gone             → operator unassigned the rider OR ticket cancelled
 */
type Stage = 'pending' | 'goingToPickup' | 'goingToCustomer' | 'atDoor' | 'delivered' | 'gone';

type GeoState = 'requesting' | 'live' | 'foreground' | 'denied' | 'off';

/**
 * Money formatter — keeps two decimals everywhere, including
 * trailing zeros (memory: never strip trailing .00 for DA/DZD).
 * No currency symbol — the rider screen is org-agnostic and we
 * don't want to mismatch with the operator's settings. Operators
 * can see the symbol on Station; the rider just needs the number.
 */
function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return Number(n).toFixed(2);
}

export default function RiderScreen() {
  const params = useLocalSearchParams<{ id: string; token: string }>();
  const ticketId = String(params.id ?? '');
  const token = String(params.token ?? '');
  const router = useRouter();

  const [ticket, setTicket] = useState<TicketDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoState>('requesting');
  const [busy, setBusy] = useState<'accept' | 'decline' | 'pickup' | 'arrived' | 'delivered' | null>(null);
  // Rider's current location, polled locally for the embedded map +
  // ETA computation. Independent of the bg-task heartbeat (which posts
  // to the server but doesn't expose its readings to React state).
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);

  // ── Fetch the ticket details on mount ──
  // We hit the same /api/rider/details endpoint the web portal uses
  // (or fall back to /api/tickets/:id if the dedicated endpoint
  // doesn't exist yet). The token verifies server-side.
  // Pull the latest ticket state. Called on mount, after every state
  // transition (accept/decline/arrived/delivered), and whenever a
  // background event might have changed things (operator unassigns,
  // customer cancels — both fire pushes that bring the app forward).
  const refreshTicket = async (mode: 'initial' | 'silent' = 'silent') => {
    if (!ticketId || !token) return;
    if (mode === 'initial') setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/rider/details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, token }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.ticket) {
        setTicket(data.ticket);
        setError(null);
      } else if (r.status === 401) {
        setError('This delivery link is invalid or expired.');
      } else if (mode === 'initial') {
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
      if (mode === 'initial') setError(e?.message ?? 'Failed to load delivery.');
    } finally {
      if (mode === 'initial') setLoading(false);
    }
  };

  useEffect(() => {
    if (!ticketId || !token) {
      setError('Missing ticket id or token.');
      setLoading(false);
      return;
    }
    void refreshTicket('initial');
    // Re-poll every 10s in case a state-change push didn't deliver
    // (e.g. notifications disabled). Lightweight — just a single row.
    const i = setInterval(() => { void refreshTicket('silent'); }, 10_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, token]);

  // ── GPS streaming — gated on accept ──
  // Streams ONLY after the rider has accepted (dispatched_at set).
  // Pre-accept the customer hasn't been told the order is on its way
  // yet, so we don't waste battery + don't ping the customer's map.
  useEffect(() => {
    if (!ticketId || !token) return;
    if (ticket?.delivered_at || !ticket?.dispatched_at) {
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
    return () => { cancelled = true; };
  }, [ticketId, token, ticket?.dispatched_at, ticket?.delivered_at]);

  // ── Local rider-position polling for the embedded map + ETA ──
  // The bg-location task heartbeats to the server but doesn't surface
  // its readings to React state. We poll the foreground location every
  // 10s for the in-app map needle + ETA readout. Cheap (single fix per
  // tick), and stops when the run ends. We DON'T await permission here
  // — that already happened inside startRiderLocationStream.
  useEffect(() => {
    if (!ticket?.dispatched_at || ticket?.delivered_at) {
      setRiderPos(null);
      return;
    }
    let cancelled = false;
    let timer: any = null;
    const tick = async () => {
      try {
        const fix = await Location.getLastKnownPositionAsync({ maxAge: 10_000 })
          ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled || !fix?.coords) return;
        const { latitude, longitude } = fix.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setRiderPos({ lat: latitude, lng: longitude });
        }
      } catch { /* permission revoked / timeout — leave previous pos */ }
    };
    void tick();
    timer = setInterval(tick, 10_000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [ticket?.dispatched_at, ticket?.delivered_at]);

  // ── Register the device's push token so the assignment / unassign /
  //    cancel notifier can hit this rider instantly even when the app
  //    is closed and the phone is locked. Token is scoped to the
  //    ticket; cleared server-side when the run completes.
  useEffect(() => {
    if (!ticketId || !token) return;
    if (ticket?.delivered_at) return;
    let cancelled = false;
    (async () => {
      try {
        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.status === 'granted';
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: false, allowSound: true },
          });
          granted = req.status === 'granted';
        }
        if (!granted || cancelled) return;
        const dev = await Notifications.getDevicePushTokenAsync();
        if (cancelled || !dev?.data) return;
        await postRegisterPush({
          ticketId,
          token,
          deviceToken: String(dev.data),
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        });
      } catch (e: any) {
        console.warn('[rider] push register failed', e?.message);
      }
    })();
    return () => { cancelled = true; };
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
  const hasPickedUp = Boolean(ticket?.picked_up_at);
  const hasAccepted = Boolean(ticket?.dispatched_at);
  const wasUnassigned = ticket && !ticket.assigned_rider_id && !ticket.delivered_at;
  const wasCancelled = ticket?.status === 'cancelled';

  const stage: Stage =
    isDelivered ? 'delivered'
    : (wasUnassigned || wasCancelled) ? 'gone'
    : hasArrived ? 'atDoor'
    : hasPickedUp ? 'goingToCustomer'
    : hasAccepted ? 'goingToPickup'
    : 'pending';

  // Active destination: restaurant during pickup leg, customer
  // address during dropoff leg. Drives the embedded map + ETA.
  const pickupCoords = ticket?.pickup?.lat != null && ticket?.pickup?.lng != null
    ? { lat: Number(ticket.pickup.lat), lng: Number(ticket.pickup.lng) } : null;
  const dropCoords = ticket?.delivery_address?.lat != null && ticket?.delivery_address?.lng != null
    ? { lat: Number(ticket.delivery_address.lat), lng: Number(ticket.delivery_address.lng) } : null;

  const activeLeg: 'pickup' | 'dropoff' | null =
    stage === 'goingToPickup' ? 'pickup'
    : stage === 'goingToCustomer' ? 'dropoff'
    : null;
  const mapDestination = activeLeg === 'pickup' ? pickupCoords : (activeLeg === 'dropoff' ? dropCoords : null);
  const legLabel = activeLeg === 'pickup' ? (ticket?.pickup?.name ?? 'Restaurant') : (ticket?.customer_data?.name ?? 'Customer');

  // Live ETA + distance for the active leg.
  const distMeters = (riderPos && mapDestination)
    ? haversineMeters(riderPos, mapDestination)
    : null;
  const distLabel = distMeters != null ? formatDistance(distMeters) : null;
  const etaLabel = distMeters != null ? formatEta(distMeters, 'scooter') : null;

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
  const onAccept = async () => {
    if (busy) return;
    setBusy('accept');
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const r = await postAccept(ticketId, token);
      if (!r.ok) throw new Error(r.error ?? 'accept failed');
      setTicket((t) => t ? { ...t, dispatched_at: r.dispatched_at ?? new Date().toISOString() } : t);
      // Ensure server-side state is reflected (e.g. customer ping
      // status, race-loser branch).
      void refreshTicket('silent');
    } catch (e: any) {
      Alert.alert('Could not accept', e?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const onDecline = async () => {
    if (busy) return;
    Alert.alert(
      'Decline this delivery?',
      'The order goes back to the restaurant. They\'ll assign someone else.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setBusy('decline');
            try {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              const r = await postDecline(ticketId, token);
              if (!r.ok) throw new Error(r.error ?? 'decline failed');
              await stopRiderLocationStream();
              setGeo('off');
              // Pop back to home — assignment is no longer ours.
              router.replace('/rider' as any);
            } catch (e: any) {
              Alert.alert('Could not decline', e?.message ?? 'Please try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const onPickup = async () => {
    if (busy) return;
    setBusy('pickup');
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      const r = await postPickup(ticketId, token);
      if (!r.ok) throw new Error(r.error ?? 'pickup failed');
      setTicket((t) => t ? { ...t, picked_up_at: r.picked_up_at ?? new Date().toISOString() } : t);
      void refreshTicket('silent');
    } catch (e: any) {
      Alert.alert('Could not confirm pickup', e?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const onArrived = async () => {
    if (busy || hasArrived || isDelivered) return;
    setBusy('arrived');
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const r = await postArrived(ticketId, token);
      if (!r.ok) throw new Error(r.error ?? 'arrived failed');
      setTicket((t) => t ? { ...t, arrived_at: r.arrived_at ?? new Date().toISOString() } : t);
      void refreshTicket('silent');
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
        {/* Header — branding + ticket number + GPS pill */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerEyebrow}>Delivery</Text>
            <Text style={styles.headerTitle}>{ticket.organization_name ?? 'Run'}</Text>
            <Text style={styles.headerTicket}>#{ticket.ticket_number}</Text>
          </View>
          <GeoPill state={geo} />
        </View>

        {/* Stage banner */}
        <View style={[
          styles.stageBanner,
          stage === 'pending'         && { backgroundColor: '#fef3c7', borderColor: '#fcd34d' },
          stage === 'goingToPickup'   && { backgroundColor: '#ffedd5', borderColor: '#fdba74' },
          stage === 'goingToCustomer' && { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
          stage === 'atDoor'          && { backgroundColor: '#dcfce7', borderColor: '#86efac' },
          stage === 'delivered'       && { backgroundColor: '#dcfce7', borderColor: '#86efac' },
          stage === 'gone'            && { backgroundColor: '#fee2e2', borderColor: '#fca5a5' },
        ]}>
          <Ionicons
            name={
              stage === 'pending'         ? 'hand-right' :
              stage === 'goingToPickup'   ? 'storefront' :
              stage === 'goingToCustomer' ? 'navigate-circle' :
              stage === 'atDoor'          ? 'home' :
              stage === 'delivered'       ? 'checkmark-done-circle' :
                                              'close-circle'
            }
            size={18}
            color={
              stage === 'pending'         ? '#b45309' :
              stage === 'goingToPickup'   ? '#9a3412' :
              stage === 'goingToCustomer' ? '#1d4ed8' :
              stage === 'atDoor'          ? '#15803d' :
              stage === 'delivered'       ? '#15803d' :
                                              '#b91c1c'
            }
          />
          <Text style={[
            styles.stageBannerText,
            stage === 'pending'         && { color: '#b45309' },
            stage === 'goingToPickup'   && { color: '#7c2d12' },
            stage === 'goingToCustomer' && { color: '#1e3a8a' },
            stage === 'atDoor'          && { color: '#14532d' },
            stage === 'delivered'       && { color: '#14532d' },
            stage === 'gone'            && { color: '#7f1d1d' },
          ]}>
            {stage === 'pending'         ? 'New assignment — review and accept' :
             stage === 'goingToPickup'   ? `Pick up at ${ticket.pickup?.name ?? 'the restaurant'}` :
             stage === 'goingToCustomer' ? `Deliver to ${ticket.customer_data?.name ?? 'the customer'}` :
             stage === 'atDoor'          ? 'At the door — hand over the order' :
             stage === 'delivered'       ? 'Delivered — well done' :
                                            wasCancelled ? 'Order cancelled' : 'You were unassigned'}
          </Text>
        </View>

        {/* Embedded live route map — only during the two driving legs */}
        {activeLeg && mapDestination ? (
          <View style={{ position: 'relative' }}>
            <RiderRouteMap
              rider={riderPos}
              destination={mapDestination}
              destinationKind={activeLeg}
              height={220}
            />
            {/* ETA + distance pill overlay (top-right) */}
            {(distLabel || etaLabel) ? (
              <View style={styles.etaPill}>
                {etaLabel ? (
                  <View style={styles.etaPillRow}>
                    <Ionicons name="time-outline" size={13} color="#0f172a" />
                    <Text style={styles.etaPillText}>{etaLabel}</Text>
                  </View>
                ) : null}
                {distLabel ? (
                  <View style={styles.etaPillRow}>
                    <Ionicons name="location-outline" size={13} color="#64748b" />
                    <Text style={[styles.etaPillText, { color: '#64748b' }]}>{distLabel}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {/* External Maps button overlay (bottom-right) */}
            {mapsUrl ? (
              <Pressable
                onPress={() => Linking.openURL(mapsUrl)}
                style={styles.mapNavOverlay}
                accessibilityLabel="Navigate in Maps"
              >
                <Ionicons name="navigate" size={16} color="#fff" />
                <Text style={styles.mapNavOverlayText}>Navigate</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* ── Pickup-leg cards: pickup info + items the rider is carrying ── */}
        {(stage === 'pending' || stage === 'goingToPickup') ? (
          <>
            {ticket.pickup ? (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.legBadgePickup}>
                    <Ionicons name="storefront" size={14} color="#9a3412" />
                    <Text style={styles.legBadgeText}>PICKUP</Text>
                  </View>
                </View>
                <Text style={styles.partyName}>{ticket.pickup.name ?? 'Restaurant'}</Text>
                {ticket.pickup.address ? (
                  <Text style={styles.addressText}>{ticket.pickup.address}</Text>
                ) : null}
                <View style={styles.contactRow}>
                  {ticket.pickup.phone ? (
                    <Pressable
                      onPress={() => Linking.openURL(`tel:${ticket.pickup!.phone}`)}
                      style={styles.contactBtn}
                    >
                      <Ionicons name="call" size={15} color="#16a34a" />
                      <Text style={styles.contactBtnText}>Call restaurant</Text>
                    </Pressable>
                  ) : null}
                  {ticket.pickup.lat != null && ticket.pickup.lng != null ? (
                    <Pressable
                      onPress={() => Linking.openURL(
                        `https://www.google.com/maps/dir/?api=1&destination=${ticket.pickup!.lat},${ticket.pickup!.lng}&dir_action=navigate`,
                      )}
                      style={styles.contactBtn}
                    >
                      <Ionicons name="navigate" size={15} color="#1d4ed8" />
                      <Text style={[styles.contactBtnText, { color: '#1d4ed8' }]}>Directions</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Items list */}
            {ticket.items && ticket.items.length > 0 ? (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardLabel}>Order — {ticket.items.length} {ticket.items.length === 1 ? 'item' : 'items'}</Text>
                  {typeof ticket.order_total === 'number' && ticket.order_total > 0 ? (
                    <Text style={styles.totalText}>{formatMoney(ticket.order_total)}</Text>
                  ) : null}
                </View>
                {ticket.items.map((it) => (
                  <View key={it.id} style={styles.itemRow}>
                    <View style={styles.itemQty}>
                      <Text style={styles.itemQtyText}>{it.qty}×</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{it.name}</Text>
                      {it.note ? <Text style={styles.itemNote}>{it.note}</Text> : null}
                    </View>
                    <Text style={styles.itemPrice}>{formatMoney(it.price * it.qty)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {/* ── Dropoff-leg cards: customer + drop-off address ── */}
        {(stage === 'goingToCustomer' || stage === 'atDoor') ? (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.legBadgeDropoff}>
                  <Ionicons name="home" size={14} color="#15803d" />
                  <Text style={[styles.legBadgeText, { color: '#15803d' }]}>DELIVER TO</Text>
                </View>
              </View>
              <Text style={styles.partyName}>{customerName ?? 'Customer'}</Text>
              {address ? <Text style={styles.addressText}>{address}</Text> : null}
              {(addressCity || addressInstructions) ? (
                <Text style={styles.addressSub}>
                  {addressCity ?? ''}{addressCity && addressInstructions ? ' · ' : ''}{addressInstructions ?? ''}
                </Text>
              ) : null}
              <View style={styles.contactRow}>
                {customerPhone ? (
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${customerPhone}`)}
                    style={styles.contactBtn}
                  >
                    <Ionicons name="call" size={15} color="#16a34a" />
                    <Text style={styles.contactBtnText}>Call</Text>
                  </Pressable>
                ) : null}
                {customerPhone ? (
                  <Pressable
                    onPress={() => Linking.openURL(`sms:${customerPhone}`)}
                    style={styles.contactBtn}
                  >
                    <Ionicons name="chatbubble-ellipses" size={15} color="#1d4ed8" />
                    <Text style={[styles.contactBtnText, { color: '#1d4ed8' }]}>Text</Text>
                  </Pressable>
                ) : null}
                {mapsUrl ? (
                  <Pressable
                    onPress={() => Linking.openURL(mapsUrl)}
                    style={styles.contactBtn}
                  >
                    <Ionicons name="navigate" size={15} color="#1d4ed8" />
                    <Text style={[styles.contactBtnText, { color: '#1d4ed8' }]}>Directions</Text>
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

            {/* Items reminder — collapsed during the dropoff leg */}
            {ticket.items && ticket.items.length > 0 ? (
              <View style={[styles.card, { paddingVertical: 12 }]}>
                <Text style={styles.cardLabel}>
                  Carrying {ticket.items.length} {ticket.items.length === 1 ? 'item' : 'items'}
                  {typeof ticket.order_total === 'number' && ticket.order_total > 0
                    ? ` · ${formatMoney(ticket.order_total)}`
                    : ''}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        {/* ── Action buttons — stage-aware ── */}
        {stage === 'pending' ? (
          <View style={{ gap: 10, marginTop: 8 }}>
            <Pressable
              onPress={onAccept}
              disabled={busy !== null}
              style={[styles.bigBtn, styles.btnAccept, busy === 'accept' && styles.btnBusy]}
            >
              {busy === 'accept' ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.bigBtnText}>Accept delivery</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={onDecline}
              disabled={busy !== null}
              style={[styles.bigBtn, styles.btnDecline, busy === 'decline' && styles.btnBusy]}
            >
              {busy === 'decline' ? <ActivityIndicator color="#dc2626" /> : (
                <>
                  <Ionicons name="close-circle" size={20} color="#dc2626" />
                  <Text style={[styles.bigBtnText, { color: '#dc2626' }]}>Decline</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : stage === 'goingToPickup' ? (
          <Pressable
            onPress={onPickup}
            disabled={busy !== null}
            style={[styles.bigBtn, styles.btnPickup, busy === 'pickup' && styles.btnBusy, { marginTop: 8 }]}
          >
            {busy === 'pickup' ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="bag-handle" size={20} color="#fff" />
                <Text style={styles.bigBtnText}>I have the order</Text>
              </>
            )}
          </Pressable>
        ) : stage === 'goingToCustomer' ? (
          <View style={{ gap: 10, marginTop: 8 }}>
            <Pressable
              onPress={onArrived}
              disabled={busy !== null}
              style={[styles.bigBtn, styles.btnArrived, busy === 'arrived' && styles.btnBusy]}
            >
              {busy === 'arrived' ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="home" size={20} color="#fff" />
                  <Text style={styles.bigBtnText}>I've arrived</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={onDelivered}
              disabled={busy !== null}
              style={[styles.bigBtn, styles.btnDelivered, busy === 'delivered' && styles.btnBusy]}
            >
              {busy === 'delivered' ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.bigBtnText}>Mark as delivered</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : stage === 'atDoor' ? (
          <Pressable
            onPress={onDelivered}
            disabled={busy !== null}
            style={[styles.bigBtn, styles.btnDelivered, busy === 'delivered' && styles.btnBusy, { marginTop: 8 }]}
          >
            {busy === 'delivered' ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.bigBtnText}>Mark as delivered</Text>
              </>
            )}
          </Pressable>
        ) : stage === 'delivered' ? (
          <View style={[styles.card, styles.deliveredCard]}>
            <Ionicons name="checkmark-circle" size={32} color="#16a34a" />
            <Text style={styles.deliveredTitle}>Order delivered</Text>
            <Text style={styles.deliveredSub}>Customer has been notified. You can close this screen.</Text>
          </View>
        ) : (
          <View style={[styles.card, styles.deliveredCard]}>
            <Ionicons name="close-circle" size={32} color="#dc2626" />
            <Text style={[styles.deliveredTitle, { color: '#dc2626' }]}>
              {wasCancelled ? 'Order cancelled' : 'No longer your delivery'}
            </Text>
            <Text style={styles.deliveredSub}>
              {wasCancelled
                ? 'The customer cancelled this order. You can close this screen.'
                : 'The operator unassigned this run. Check the home screen for new work.'}
            </Text>
          </View>
        )}

        {/* Footer — only relevant when GPS is meant to be running */}
        {(stage === 'goingToPickup' || stage === 'goingToCustomer' || stage === 'atDoor') ? (
          <Text style={styles.footer}>
            Live location streams in the background — even when your phone is locked.
            {'\n'}Stops automatically once the order is delivered.
          </Text>
        ) : null}
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
  btnAccept:    { backgroundColor: '#1d4ed8' },
  btnDecline:   { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#fca5a5' },
  btnPickup:    { backgroundColor: '#f97316' },
  btnBusy:      { opacity: 0.7 },
  bigBtnText: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.2 },

  // ── Map overlays ────────────────────────────────────────────
  etaPill: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, gap: 2,
    shadowColor: '#0f172a', shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 2 }, shadowRadius: 6, elevation: 4,
  },
  etaPillRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  etaPillText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  mapNavOverlay: {
    position: 'absolute', bottom: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: '#1d4ed8',
    shadowColor: '#0f172a', shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 }, shadowRadius: 6, elevation: 4,
  },
  mapNavOverlayText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // ── Card sub-bits ───────────────────────────────────────────
  cardHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  legBadgePickup: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: '#ffedd5',
  },
  legBadgeDropoff: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: '#dcfce7',
  },
  legBadgeText: { fontSize: 11, fontWeight: '800', color: '#9a3412', letterSpacing: 0.5 },
  partyName: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  contactBtnText: { fontSize: 13, fontWeight: '700', color: '#16a34a' },
  totalText: { fontSize: 15, fontWeight: '700', color: '#0f172a', fontVariant: ['tabular-nums'] },

  // ── Items list ──────────────────────────────────────────────
  itemRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0',
  },
  itemQty: {
    minWidth: 32, alignItems: 'center',
    paddingHorizontal: 6, paddingVertical: 4,
    borderRadius: 6, backgroundColor: '#f1f5f9',
  },
  itemQtyText: { fontSize: 13, fontWeight: '800', color: '#475569' },
  itemName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  itemNote: { fontSize: 12, color: '#64748b', marginTop: 2, fontStyle: 'italic' },
  itemPrice: { fontSize: 14, color: '#0f172a', fontVariant: ['tabular-nums'] },

  stageBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, marginTop: 4,
  },
  stageBannerText: { fontSize: 13, fontWeight: '700', flex: 1 },

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
