import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Linking,
  PanResponder,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '@/lib/store';
import { fetchTicket, stopTracking } from '@/lib/api';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

const WEB_BASE = 'https://qflow-sigma.vercel.app';
const CALL_WAIT_SECONDS = 60;

// ===========================================================================
// Shared sub-components
// ===========================================================================

// ---------------------------------------------------------------------------
// Pulsing dot (waiting indicator)
// ---------------------------------------------------------------------------
function PulsingDot({ color = '#22d3ee' }: { color?: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 2, duration: 2000, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 2000, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [scale, opacity]);
  return (
    <View style={{ width: 16, height: 16, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: color, transform: [{ scale }], opacity }} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Animated progress bar
// ---------------------------------------------------------------------------
function ProgressBar({ position }: { position: number | null }) {
  const pos = position ?? 1;
  const progress = Math.max(0.08, Math.min(0.92, (14 - Math.min(pos, 14)) / 14));
  const widthAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(widthAnim, { toValue: progress, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [progress, widthAnim]);
  return (
    <View style={s.progressTrack}>
      <Animated.View style={[s.progressFill, { width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Metric card (matches web WaitingMetric)
// ---------------------------------------------------------------------------
function MetricCard({ label, value, detail, accentColor, smallValue }: { label: string; value: string; detail: string; accentColor: string; smallValue?: boolean }) {
  return (
    <View style={s.metricCard}>
      <Text style={[s.metricLabel, { color: accentColor }]}>{label}</Text>
      <Text style={[s.metricValue, smallValue && { fontSize: 16 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.metricDetail}>{detail}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pill button (matches web QueueActionPill)
// ---------------------------------------------------------------------------
function Pill({ label, onPress, tone = 'primary' }: { label: string; onPress: () => void; tone?: 'primary' | 'danger' | 'secondary' }) {
  const bg = tone === 'primary' ? 'rgba(255,255,255,1)' : tone === 'danger' ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.10)';
  const border = tone === 'primary' ? 'rgba(255,255,255,0.12)' : tone === 'danger' ? 'rgba(244,63,94,0.25)' : 'rgba(255,255,255,0.12)';
  const textColor = tone === 'primary' ? '#0f172a' : tone === 'danger' ? '#fecdd3' : '#fff';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ borderWidth: 1, borderColor: border, backgroundColor: bg, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: textColor }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Countdown circle (matches web YourTurn countdown)
// ---------------------------------------------------------------------------
function CountdownCircle({ calledAt }: { calledAt: string }) {
  const [remaining, setRemaining] = useState(CALL_WAIT_SECONDS);
  useEffect(() => {
    const start = new Date(calledAt).getTime();
    const tick = () => setRemaining(Math.max(0, CALL_WAIT_SECONDS - Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [calledAt]);

  const phase = remaining > 30 ? 'green' : remaining > 10 ? 'yellow' : 'red';
  const expired = remaining === 0;
  return (
    <View style={[s.countdownCircle, { borderColor: 'rgba(255,255,255,0.30)', backgroundColor: 'rgba(255,255,255,0.15)' }]}>
      <Text style={s.countdownNumber}>{remaining}</Text>
      <Text style={s.countdownLabel}>{expired ? 'EXPIRED' : 'SECONDS'}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Countdown bar (linear, for called card bottom)
// ---------------------------------------------------------------------------
function CountdownBar({ calledAt }: { calledAt: string }) {
  const [remaining, setRemaining] = useState(CALL_WAIT_SECONDS);
  useEffect(() => {
    const start = new Date(calledAt).getTime();
    const tick = () => setRemaining(Math.max(0, CALL_WAIT_SECONDS - Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [calledAt]);
  const progress = remaining / CALL_WAIT_SECONDS;
  const color = remaining > 30 ? '#22c55e' : remaining > 10 ? '#f59e0b' : '#ef4444';
  return (
    <View style={{ width: '100%', gap: 4 }}>
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
        {remaining === 0 ? "Time's up – please check with staff" : 'Please proceed to the counter'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Elapsed timer (for serving state)
// ---------------------------------------------------------------------------
function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState('00:00');
  useEffect(() => {
    const sinceMs = new Date(since).getTime();
    const update = () => {
      const diff = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
      const m = Math.floor(diff / 60);
      const sec = diff % 60;
      setElapsed(`${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [since]);
  return <Text style={s.elapsedTime}>{elapsed}</Text>;
}

// ---------------------------------------------------------------------------
// Star rating
// ---------------------------------------------------------------------------
function StarRating({ rating, onRate }: { rating: number; onRate: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onRate(n)} activeOpacity={0.7}>
          <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={32} color={n <= rating ? '#facc15' : '#475569'} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// History card
// ---------------------------------------------------------------------------
const HISTORY_STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  served: { label: 'Served', color: '#22c55e', icon: 'checkmark-circle' },
  no_show: { label: 'Missed', color: '#f59e0b', icon: 'alert-circle' },
  cancelled: { label: 'Cancelled', color: '#ef4444', icon: 'close-circle' },
  waiting: { label: 'Waiting', color: '#3b82f6', icon: 'time' },
  called: { label: 'Called', color: '#f59e0b', icon: 'megaphone' },
  serving: { label: 'Serving', color: '#8b5cf6', icon: 'pulse' },
};

function HistoryCard({ entry, onPress, colors: c }: { entry: { token: string; ticketNumber: string; officeName: string; serviceName: string; status: string; date: string }; onPress: () => void; colors?: any }) {
  const { colors: themeColors } = useTheme();
  const col = c || themeColors;
  const d = new Date(entry.date);
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const statusCfg = HISTORY_STATUS_CONFIG[entry.status] ?? HISTORY_STATUS_CONFIG.served;
  return (
    <TouchableOpacity style={[s.historyCard, { backgroundColor: col.surface, borderColor: col.borderLight }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[s.historyCardIcon, { backgroundColor: col.infoLight }]}><Ionicons name="receipt-outline" size={20} color={col.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[s.historyCardTitle, { color: col.text }]} numberOfLines={1}>{entry.officeName}</Text>
        <Text style={[s.historyCardSub, { color: col.textSecondary }]} numberOfLines={1}>{entry.serviceName}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={[s.historyStatusBadge, { backgroundColor: statusCfg.color + '18' }]}>
          <Ionicons name={statusCfg.icon as any} size={12} color={statusCfg.color} />
          <Text style={[s.historyStatusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
        <Text style={[s.historyCardDate, { color: col.textMuted }]}>{dateStr}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Info row item (for "Your Turn" card — where to go, what to show, what to do)
// ---------------------------------------------------------------------------
function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <View style={s.infoRowIcon}><Ionicons name={icon} size={20} color="rgba(255,255,255,0.8)" /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.infoRowLabel}>{label}</Text>
        <Text style={s.infoRowValue}>{value}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Visit details grid (SERVICE / SOURCE / CHECKED IN / DEPARTMENT)
// ---------------------------------------------------------------------------
function VisitDetailsGrid({ ticket: t }: { ticket: import('@/lib/api').TicketResponse }) {
  const checkedIn = new Date(t.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const source = t.is_remote ? 'Remote join' : 'Walk-in visit';
  const items: Array<{ label: string; value: string }> = [
    { label: 'SERVICE', value: t.service?.name ?? t.department?.name ?? '--' },
    { label: 'SOURCE', value: source },
    { label: 'CHECKED IN', value: checkedIn },
    { label: 'DEPARTMENT', value: t.department?.name ?? '--' },
  ];
  return (
    <View style={s.detailsGrid}>
      {items.map((item) => (
        <View key={item.label} style={s.detailsCell}>
          <Text style={s.detailsCellLabel}>{item.label}</Text>
          <Text style={s.detailsCellValue} numberOfLines={2}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Customer info card — always shown, fallback to "No intake collected"
// ---------------------------------------------------------------------------
function CustomerInfoCard({ ticket: t }: { ticket: import('@/lib/api').TicketResponse }) {
  const cd = t.customer_data;
  const hasData = cd && (cd.name || cd.phone || cd.email);
  return (
    <View style={s.customerCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Ionicons name="person-circle-outline" size={18} color="#94a3b8" />
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', letterSpacing: 1.5, textTransform: 'uppercase' }}>Customer</Text>
      </View>
      {!hasData ? (
        <Text style={{ fontSize: 14, color: '#475569', fontStyle: 'italic' }}>No intake collected</Text>
      ) : (
        <>
          {cd?.name ? (
            <View style={s.customerRow}>
              <Ionicons name="person-outline" size={15} color="#94a3b8" />
              <Text style={s.customerLabel}>Name</Text>
              <Text style={s.customerValue}>{cd.name}</Text>
            </View>
          ) : null}
          {cd?.phone ? (
            <View style={s.customerRow}>
              <Ionicons name="call-outline" size={15} color="#94a3b8" />
              <Text style={s.customerLabel}>Phone</Text>
              <Text style={s.customerValue}>{cd.phone}</Text>
            </View>
          ) : null}
          {cd?.email ? (
            <View style={s.customerRow}>
              <Ionicons name="mail-outline" size={15} color="#94a3b8" />
              <Text style={s.customerLabel}>Email</Text>
              <Text style={s.customerValue}>{cd.email}</Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

// ===========================================================================
// Main screen
// ===========================================================================
export default function HomeScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { activeToken, activeTicket, setActiveToken, setActiveTicket, clearActiveTicket, history } = useAppStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [rating, setRating] = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncLabel, setSyncLabel] = useState('Syncing...');
  const failCountRef = useRef(0);
  const activeTicketRef = useRef(activeTicket);
  activeTicketRef.current = activeTicket;

  // ---- Polling ----
  const poll = useCallback(async () => {
    if (!activeToken) return;
    const ticket = await fetchTicket(activeToken);
    if (!ticket) {
      failCountRef.current += 1;
      if (failCountRef.current >= 3 && !activeTicketRef.current) setLoadError('Could not find this ticket. The code may be invalid or expired.');
      return;
    }
    failCountRef.current = 0;
    setLoadError(null);
    setSyncLabel(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    if (prevStatusRef.current && prevStatusRef.current !== ticket.status) {
      if (ticket.status === 'called') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      else if (ticket.status === 'serving') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else if (['served', 'no_show', 'cancelled'].includes(ticket.status)) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    prevStatusRef.current = ticket.status;
    setActiveTicket(ticket);
  }, [activeToken, setActiveTicket]);

  useEffect(() => {
    if (!activeToken) return;
    failCountRef.current = 0; setLoadError(null);
    poll();
    intervalRef.current = setInterval(poll, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [activeToken, poll]);

  useEffect(() => { setRating(0); setRatingSubmitted(false); }, [activeToken]);

  const handleStopTracking = () => {
    // Cancel on server (fire-and-forget) then clear local state
    if (activeTicket?.id) stopTracking(activeTicket.id);
    clearActiveTicket();
    prevStatusRef.current = null;
  };
  const confirmEndVisit = () => {
    Alert.alert(
      'End visit?',
      'You will stop tracking this ticket. You can rejoin later from your history.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Visit', style: 'destructive', onPress: handleStopTracking },
      ],
    );
  };
  // Swipe left to return: triggers end confirmation when user swipes left past threshold
  const swipeAnim = useRef(new Animated.Value(0)).current;
  const swipePan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, gs) => gs.dx < -15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
    onPanResponderMove: (_e, gs) => {
      if (gs.dx < 0) swipeAnim.setValue(Math.max(gs.dx * 0.4, -80));
    },
    onPanResponderRelease: (_e, gs) => {
      if (gs.dx < -100) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        confirmEndVisit();
      }
      Animated.spring(swipeAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
    },
  }), [confirmEndVisit, swipeAnim]);

  const handleRefresh = async () => { setRefreshing(true); await poll(); setRefreshing(false); };

  const handleManualSubmit = () => {
    const trimmed = manualCode.trim();
    if (!trimmed) return;
    const qMatch = trimmed.match(/\/q\/([a-zA-Z0-9_-]+)/);
    const joinMatch = trimmed.match(/\/join\/([a-zA-Z0-9_-]+)/);
    const kioskMatch = trimmed.match(/\/kiosk\/([a-zA-Z0-9_-]+)/);
    const bookMatch = trimmed.match(/\/book\/([a-zA-Z0-9_-]+)/);
    if (joinMatch) router.push(`/join/${joinMatch[1]}` as any);
    else if (kioskMatch) router.push(`/kiosk/${kioskMatch[1]}` as any);
    else if (bookMatch) Linking.openURL(`${WEB_BASE}/book/${bookMatch[1]}`);
    else {
      const token = qMatch ? qMatch[1] : (/^[a-zA-Z0-9_-]{8,}$/.test(trimmed) ? trimmed : null);
      if (token) setActiveToken(token);
    }
    setManualCode(''); setShowManualEntry(false);
  };

  // =======================================================================
  // EMPTY STATE — no active token
  // =======================================================================
  if (!activeToken) {
    const recentHistory = history.slice(0, 3);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={s.emptyContent}>
        <View style={s.illustrationArea}>
          <View style={[s.illustrationOuter, { backgroundColor: isDark ? 'rgba(59,130,246,0.15)' : colors.primaryLight + '1F' }]}>
            <View style={[s.illustrationMiddle, { backgroundColor: isDark ? 'rgba(59,130,246,0.25)' : colors.primary + '59' }]}>
              <View style={[s.illustrationInner, { backgroundColor: isDark ? 'rgba(59,130,246,0.18)' : colors.surface }]}>
                <Ionicons name="ticket" size={48} color={isDark ? '#60a5fa' : colors.primary} />
              </View>
            </View>
          </View>
        </View>
        <Text style={[s.emptyHeadline, { color: colors.text }]}>Join a Queue</Text>
        <Text style={[s.emptySubtitle, { color: colors.textSecondary }]}>Scan a QR code at any location to get your ticket</Text>
        <TouchableOpacity style={[s.scanButton, { backgroundColor: colors.primary, shadowColor: colors.primary }]} onPress={() => router.push('/scan' as any)} activeOpacity={0.8}>
          <Ionicons name="qr-code-outline" size={22} color="#fff" /><Text style={s.scanButtonText}>Scan QR Code</Text>
        </TouchableOpacity>
        {!showManualEntry ? (
          <TouchableOpacity onPress={() => setShowManualEntry(true)} activeOpacity={0.6}><Text style={[s.manualLink, { color: colors.textMuted }]}>Or enter code manually</Text></TouchableOpacity>
        ) : (
          <View style={s.manualBox}>
            <TextInput style={[s.manualInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} placeholder="Paste ticket code..." placeholderTextColor={colors.textMuted} value={manualCode} onChangeText={setManualCode} autoCapitalize="none" autoCorrect={false} returnKeyType="go" onSubmitEditing={handleManualSubmit} />
            <TouchableOpacity style={[s.manualGo, { backgroundColor: colors.primary }, !manualCode.trim() && { backgroundColor: colors.textMuted }]} onPress={handleManualSubmit} disabled={!manualCode.trim()}><Ionicons name="arrow-forward" size={20} color="#fff" /></TouchableOpacity>
          </View>
        )}
        {recentHistory.length > 0 && (
          <View style={s.recentSection}>
            <Text style={[s.recentTitle, { color: colors.textMuted }]}>Recent visits</Text>
            {recentHistory.map((e) => <HistoryCard key={e.token} entry={e} onPress={() => setActiveToken(e.token)} colors={colors} />)}
          </View>
        )}
      </ScrollView>
    );
  }

  // =======================================================================
  // LOADING STATE
  // =======================================================================
  if (!activeTicket) {
    if (loadError) {
      return (
        <View style={[s.centerScreen, { backgroundColor: colors.background }]}>
          <View style={[s.errorCircle, { backgroundColor: colors.errorLight }]}><Ionicons name="alert-circle-outline" size={48} color={colors.error} /></View>
          <Text style={[s.errorTitle, { color: colors.text }]}>Ticket Not Found</Text>
          <Text style={[s.errorSub, { color: colors.textSecondary }]}>{loadError}</Text>
          <View style={{ gap: 10, marginTop: 16, width: '100%', maxWidth: 260 }}>
            <TouchableOpacity style={[s.retryBtn, { backgroundColor: colors.primary }]} onPress={() => { failCountRef.current = 0; setLoadError(null); poll(); }} activeOpacity={0.7}>
              <Ionicons name="refresh" size={18} color="#fff" /><Text style={s.retryBtnText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.dismissBtn, { borderColor: colors.border }]} onPress={() => { setActiveToken(null); setActiveTicket(null); setLoadError(null); failCountRef.current = 0; }} activeOpacity={0.7}>
              <Text style={[s.dismissBtnText, { color: colors.textSecondary }]}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return <View style={[s.centerScreen, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /><Text style={{ fontSize: 15, color: colors.textSecondary }}>Loading your ticket...</Text></View>;
  }

  // =======================================================================
  // Derived state
  // =======================================================================
  const t = activeTicket;
  const isWaiting = t.status === 'waiting';
  const isCalled = t.status === 'called';
  const isServing = t.status === 'serving';
  const isTerminal = ['served', 'no_show', 'cancelled'].includes(t.status);
  const serviceLabel = t.service?.name ?? t.department?.name ?? '';
  const officeName = t.office?.name ?? 'Queue';
  const peopleAhead = t.position != null && t.position > 0 ? t.position - 1 : 0;
  const positionText = t.position ? (t.position === 1 ? "You're Next!" : t.position <= 3 ? 'Almost there!' : `${peopleAhead} ahead of you`) : '--';
  const deskName = t.desk?.name ?? 'your desk';

  // =======================================================================
  // CALLED STATE — gradient background, bell, countdown circle, info card
  // Matches web your-turn.tsx exactly
  // =======================================================================
  if (isCalled) {
    const remaining = t.called_at ? Math.max(0, CALL_WAIT_SECONDS - Math.floor((Date.now() - new Date(t.called_at).getTime()) / 1000)) : CALL_WAIT_SECONDS;
    const phase = remaining > 30 ? 'green' : remaining > 10 ? 'yellow' : 'red';
    const bgColor = phase === 'green' ? '#1a6f49' : phase === 'yellow' ? '#b97613' : '#8e1f1f';

    return (
      <Animated.View style={{ flex: 1, transform: [{ translateX: swipeAnim }] }} {...swipePan.panHandlers}>
      <ScrollView
        style={{ flex: 1, backgroundColor: bgColor }}
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="rgba(255,255,255,0.6)" />}
      >
        {/* Header: office name + ticket badge + pills */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.8)', letterSpacing: 2, textTransform: 'uppercase' }}>{officeName}</Text>
            <Text style={{ fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{serviceLabel}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{syncLabel}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <View style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 9999 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.88)', letterSpacing: 1.5 }}>Ticket {t.ticket_number}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pill label="Refresh" onPress={handleRefresh} tone="primary" />
              <Pill label="End" onPress={confirmEndVisit} tone="danger" />
            </View>
          </View>
        </View>

        {/* Bell icon + Go to desk */}
        <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center', gap: 8 }}>
          {/* Bell rings */}
          <View style={{ width: 128, height: 128, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ position: 'absolute', width: 128, height: 128, borderRadius: 64, backgroundColor: 'rgba(255,255,255,0.12)' }} />
            <View style={{ position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.12)' }} />
            <View style={{ position: 'absolute', width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.18)' }} />
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.22)', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="notifications" size={32} color="#fff" />
            </View>
          </View>

          <Text style={{ fontSize: 36, fontWeight: '900', color: '#fff', textAlign: 'center', letterSpacing: -0.5, marginTop: 12 }}>
            Go to {deskName}
          </Text>

          {/* Recall badge */}
          {(t.recall_count ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.12)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9999 }}>
              <Ionicons name="refresh" size={14} color="#fff" />
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#fff' }}>Recalled {t.recall_count} {(t.recall_count ?? 0) === 1 ? 'time' : 'times'}</Text>
            </View>
          )}

          {/* Countdown circle */}
          {t.called_at && <CountdownCircle calledAt={t.called_at} />}

          {/* Message */}
          <Text style={{ fontSize: 15, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 8 }}>
            {remaining === 0 ? 'Time expired. Please go to the desk immediately.' : phase === 'red' ? 'Please head over now. Staff is waiting.' : 'Show this screen if staff asks for your number.'}
          </Text>

          {/* Info card */}
          <View style={s.infoCard}>
            <InfoRow icon="location-outline" label="Where to go" value={deskName} />
            <InfoRow icon="document-text-outline" label="What to show" value={`Ticket ${t.ticket_number}`} />
            <InfoRow icon="time-outline" label="What to do now" value="Walk straight to the desk while the countdown is active." />
          </View>
        </View>

        <CustomerInfoCard ticket={t} />

        <Text style={s.footer}>Powered by QueueFlow</Text>
      </ScrollView>
      </Animated.View>
    );
  }

  // =======================================================================
  // SERVING STATE — dark bg, "With staff now" badge, desk + ticket metrics
  // Matches web queue-status serving section
  // =======================================================================
  if (isServing) {
    return (
      <Animated.View style={{ flex: 1, transform: [{ translateX: swipeAnim }] }} {...swipePan.panHandlers}>
      <ScrollView
        style={s.darkBg}
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#94a3b8" />}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.businessName}>{officeName}</Text>
            {serviceLabel ? <Text style={s.branchLabel}>{serviceLabel}</Text> : null}
            <Text style={s.syncText}>{syncLabel}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <Pill label="Refresh" onPress={handleRefresh} tone="secondary" />
            <Pill label="End" onPress={confirmEndVisit} tone="danger" />
          </View>
        </View>

        {/* Main card */}
        <View style={s.mainCard}>
          <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: 'rgba(56,189,248,0.12)', justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="people" size={36} color="#7dd3fc" />
          </View>
          <View style={{ backgroundColor: 'rgba(56,189,248,0.12)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 9999 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#7dd3fc', letterSpacing: 1.5, textTransform: 'uppercase' }}>With staff now</Text>
          </View>
          <Text style={{ fontSize: 26, fontWeight: '700', color: '#fff', textAlign: 'center' }}>You are being served</Text>
          <Text style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 20 }}>Stay with the staff member at {deskName}.</Text>

          <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
            <MetricCard label="Ticket" value={t.ticket_number} detail="Keep visible if asked" accentColor="#7dd3fc" />
            <MetricCard label="Desk" value={deskName} detail="Current service point" accentColor="#34d399" />
          </View>

          {t.serving_started_at && (
            <View style={{ alignItems: 'center', marginTop: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 1.5, textTransform: 'uppercase' }}>Session time</Text>
              <ElapsedTimer since={t.serving_started_at} />
            </View>
          )}
        </View>

        <CustomerInfoCard ticket={t} />

        <Text style={s.footer}>QueueFlow</Text>
      </ScrollView>
      </Animated.View>
    );
  }

  // =======================================================================
  // TERMINAL STATES — served (feedback), no_show, cancelled
  // Matches web feedback-form.tsx / queue-session-ended.tsx
  // =======================================================================
  if (isTerminal) {
    const iconName = t.status === 'served' ? 'checkmark-circle' : t.status === 'no_show' ? 'alert-circle' : 'close-circle';
    const iconColor = t.status === 'served' ? '#4ade80' : t.status === 'no_show' ? '#fbbf24' : '#f87171';
    const title = t.status === 'served' ? 'Visit complete!' : t.status === 'no_show' ? 'Missed your turn' : 'Ticket cancelled';
    const description = t.status === 'served' ? 'Thank you for visiting.' : t.status === 'no_show' ? 'The desk marked this ticket as missed. Please talk to staff if you still need help.' : 'This ticket is no longer active in the queue.';

    return (
      <ScrollView style={s.darkBg} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text style={s.businessName}>{officeName}</Text>
        </View>

        <View style={[s.mainCard, { gap: 16 }]}>
          <Ionicons name={iconName as any} size={56} color={iconColor} />
          <Text style={{ fontSize: 24, fontWeight: '700', color: '#f1f5f9', textAlign: 'center' }}>{title}</Text>
          <Text style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 20, maxWidth: 280 }}>{description}</Text>
          <Text style={{ fontSize: 13, color: '#64748b', fontWeight: '600' }}>Ticket {t.ticket_number}</Text>

          {t.status === 'served' && (
            <View style={{ alignItems: 'center', gap: 8, marginTop: 4 }}>
              {!ratingSubmitted ? (
                <>
                  <Text style={{ fontSize: 15, color: '#94a3b8' }}>Rate your experience</Text>
                  <StarRating rating={rating} onRate={(n) => { setRating(n); setRatingSubmitted(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} />
                </>
              ) : (
                <Text style={{ fontSize: 15, color: '#4ade80', fontWeight: '600' }}>Thanks for your feedback!</Text>
              )}
            </View>
          )}

          <TouchableOpacity onPress={handleStopTracking} activeOpacity={0.8} style={{ alignItems: 'center', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 9999, backgroundColor: '#3b82f6', width: '100%', marginTop: 8 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>Done</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>QueueFlow</Text>
      </ScrollView>
    );
  }

  // =======================================================================
  // WAITING STATE — matches web queue-status waiting view exactly
  // Dark bg, ticket card with number + position, progress bar, 3 metrics, alerts
  // =======================================================================
  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: swipeAnim }] }} {...swipePan.panHandlers}>
    <ScrollView
      style={s.darkBg}
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#94a3b8" />}
    >
      {/* Header: business name, sync, status badge, action pills */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.businessName} numberOfLines={1}>{officeName}</Text>
          {serviceLabel ? <Text style={s.branchLabel}>{serviceLabel}</Text> : null}
          <Text style={s.syncText}>{syncLabel}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <View style={{ backgroundColor: 'rgba(251,191,36,0.15)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 9999 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#fde68a', letterSpacing: 1.5 }}>WAITING IN LINE</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill label="Refresh" onPress={handleRefresh} tone="secondary" />
            <Pill label="End" onPress={confirmEndVisit} tone="danger" />
          </View>
        </View>
      </View>

      {/* Main ticket card */}
      <View style={s.mainCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, width: '100%' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 2, textTransform: 'uppercase' }}>Ticket</Text>
            <Text style={{ fontSize: 36, fontWeight: '900', color: '#fff', letterSpacing: 1, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>{t.ticket_number}</Text>
            {serviceLabel ? <Text style={{ fontSize: 14, fontWeight: '500', color: '#cbd5e1', marginTop: 4 }}>{serviceLabel}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 48, fontWeight: '700', color: t.position === 1 ? '#10b981' : '#fff', lineHeight: 52 }}>{t.position === 1 ? '🔔' : t.position ? `#${t.position}` : '--'}</Text>
            <Text style={{ fontSize: 13, color: t.position === 1 ? '#10b981' : 'rgba(34,211,238,0.7)', fontWeight: t.position === 1 ? '700' : '400', marginTop: 4 }}>{positionText}</Text>
          </View>
        </View>

        {/* Queue progress */}
        <View style={{ gap: 8, width: '100%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <PulsingDot color="#22d3ee" />
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 1.2, textTransform: 'uppercase' }}>Queue progress</Text>
            </View>
            <Text style={{ fontSize: 11, fontWeight: '600', color: t.position === 1 ? '#10b981' : '#34d399', letterSpacing: 1.2 }}>
              {t.position === 1 ? "You're Next!" : t.position ? `#${t.position} in line` : '--'}
            </Text>
          </View>
          <ProgressBar position={t.position} />
        </View>
      </View>

      {/* 3 Metric cards */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <MetricCard label="Wait" value={t.position === 1 ? 'Now' : t.estimated_wait_minutes != null ? `${t.estimated_wait_minutes} min` : '--'} detail={t.position === 1 ? 'Any moment now' : t.estimated_wait_minutes != null ? 'Approximate timing' : 'Calculating time'} accentColor="#38bdf8" />
        <MetricCard label="Now serving" value={t.now_serving ?? '--'} detail="Current desk activity" accentColor="#34d399" smallValue />
        <MetricCard label="Alerts" value="Ready" detail="Background alerts on" accentColor="#fbbf24" />
      </View>

      {/* Visit details grid */}
      <VisitDetailsGrid ticket={t} />

      {/* Customer info card — always shown */}
      <CustomerInfoCard ticket={t} />

      {/* Alerts enabled banner */}
      <View style={s.alertsBanner}>
        <Ionicons name="notifications-outline" size={16} color="#34d399" />
        <Text style={{ fontSize: 13, fontWeight: '500', color: '#cbd5e1', flex: 1 }}>Alerts enabled — we'll notify you when it's your turn</Text>
      </View>

      <Text style={s.footer}>QueueFlow</Text>
    </ScrollView>
    </Animated.View>
  );
}

// ===========================================================================
// Styles
// ===========================================================================
const s = StyleSheet.create({
  darkBg: { flex: 1, backgroundColor: '#020617' },
  centerScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },

  // Empty state
  emptyContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 64, paddingBottom: 32 },
  illustrationArea: { marginBottom: 32 },
  illustrationOuter: { width: 160, height: 160, borderRadius: 80, justifyContent: 'center', alignItems: 'center' },
  illustrationMiddle: { width: 120, height: 120, borderRadius: 60, justifyContent: 'center', alignItems: 'center' },
  illustrationInner: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 4 },
  emptyHeadline: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  emptySubtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 280, marginBottom: 20 },
  scanButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, width: '100%', maxWidth: 320, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  scanButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  manualLink: { fontSize: 13, marginTop: 12, textDecorationLine: 'underline' },
  manualBox: { flexDirection: 'row', alignItems: 'center', marginTop: 12, width: '100%', maxWidth: 320, gap: 8 },
  manualInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  manualGo: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  recentSection: { marginTop: 32, width: '100%' },
  recentTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8, paddingHorizontal: 4 },

  // History card
  historyCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, gap: 12 },
  historyCardIcon: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  historyCardTitle: { fontSize: 15, fontWeight: '600' },
  historyCardSub: { fontSize: 13, marginTop: 1 },
  historyCardDate: { fontSize: 11 },
  historyStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999 },
  historyStatusText: { fontSize: 11, fontWeight: '600' },

  // Error state
  errorCircle: { width: 88, height: 88, borderRadius: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  errorTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorSub: { fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16 },
  retryBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  dismissBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 16, borderWidth: 1.5 },
  dismissBtnText: { fontSize: 15, fontWeight: '600' },

  // Shared dark-mode elements
  businessName: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  branchLabel: { fontSize: 14, fontWeight: '500', color: '#94a3b8', marginTop: 2 },
  syncText: { fontSize: 13, color: '#64748b', marginTop: 2 },

  // Main card (shared between waiting/serving/terminal)
  mainCard: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    padding: 20, alignItems: 'center', gap: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.25, shadowRadius: 40, elevation: 8,
  },

  // Progress
  progressTrack: { height: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 9999, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#22d3ee', borderRadius: 9999 },

  // Metric cards
  metricCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', padding: 14 },
  metricLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  metricValue: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  metricDetail: { fontSize: 10, color: '#64748b', marginTop: 4, lineHeight: 14 },

  // Visit details grid
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailsCell: { width: '47%', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 12 },
  detailsCellLabel: { fontSize: 10, fontWeight: '700', color: '#475569', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  detailsCellValue: { fontSize: 14, fontWeight: '600', color: '#e2e8f0', lineHeight: 20 },

  // Customer info card
  customerCard: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', padding: 16 },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  customerLabel: { fontSize: 12, color: '#64748b', width: 50 },
  customerValue: { fontSize: 14, fontWeight: '600', color: '#e2e8f0', flex: 1 },

  // Alerts banner
  alertsBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 9999 },

  // Countdown circle (called state)
  countdownCircle: { width: 160, height: 160, borderRadius: 80, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  countdownNumber: { fontSize: 52, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] },
  countdownLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 2, marginTop: 4 },

  // Elapsed time (serving)
  elapsedTime: { fontSize: 28, fontWeight: '700', color: '#34d399', fontVariant: ['tabular-nums'], marginTop: 4 },

  // Info card (called state)
  infoCard: { width: '100%', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.12)', padding: 20, gap: 16, marginTop: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoRowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  infoRowLabel: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.55)' },
  infoRowValue: { fontSize: 15, fontWeight: '600', color: '#fff', marginTop: 1 },

  // Footer
  footer: { fontSize: 11, fontWeight: '600', color: '#334155', letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center', marginTop: 'auto', paddingTop: 16 },
});
