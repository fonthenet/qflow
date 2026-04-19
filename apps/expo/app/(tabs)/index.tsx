import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Linking,
  PanResponder,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useAppStore } from '@/lib/store';
import { fetchTicket, fetchAppointmentWithTicket, stopTracking, submitFeedback, fetchFeedback } from '@/lib/api';
import { cancelTicket } from '@/lib/ticket-actions';
import { formatTime, formatDate } from '@/lib/format-date';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

import { API_BASE_URL as WEB_BASE } from '@/lib/config';
const CALL_WAIT_SECONDS = 60;

// ===========================================================================
// Phase palette — theme-aware colors for ticket phase screens
// (waiting / serving / terminal). The "called" state keeps its semantic
// green/amber/red urgency color in both themes.
// ===========================================================================
function usePhasePalette() {
  const { colors, isDark } = useTheme();
  if (isDark) {
    return {
      bg: '#020617',
      cardBg: 'rgba(255,255,255,0.06)',
      cardBorder: 'rgba(255,255,255,0.10)',
      innerBg: 'rgba(255,255,255,0.05)',
      innerBorder: 'rgba(255,255,255,0.08)',
      customerCardBg: 'rgba(15,23,42,0.35)',
      customerBorder: 'rgba(255,255,255,0.18)',
      divider: 'rgba(255,255,255,0.10)',
      inputBg: 'rgba(255,255,255,0.05)',
      inputBorder: 'rgba(255,255,255,0.10)',
      inputText: '#f1f5f9',
      inputPlaceholder: '#64748b',
      title: '#fff',
      heading: '#f1f5f9',
      text: '#e2e8f0',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
      textFaint: '#64748b',
      refreshTint: '#94a3b8',
      trackBg: 'rgba(255,255,255,0.08)',
      footerColor: '#475569',
      accent: colors.primary,
      iconColor: '#e2e8f0',
    };
  }
  return {
    bg: colors.background,
    cardBg: colors.surface,
    cardBorder: colors.border,
    innerBg: colors.surfaceSecondary,
    innerBorder: colors.borderLight,
    customerCardBg: colors.surface,
    customerBorder: colors.border,
    divider: colors.borderLight,
    inputBg: colors.surfaceSecondary,
    inputBorder: colors.border,
    inputText: colors.text,
    inputPlaceholder: colors.textMuted,
    title: colors.text,
    heading: colors.text,
    text: colors.text,
    textSecondary: colors.textSecondary,
    textMuted: colors.textMuted,
    textFaint: colors.textMuted,
    refreshTint: colors.textSecondary,
    trackBg: colors.borderLight,
    footerColor: colors.textMuted,
    accent: colors.primary,
    iconColor: colors.textSecondary,
  };
}

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
// Animated bell — pulsing rings + gentle wiggle
// ---------------------------------------------------------------------------
function AnimatedBell() {
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.6)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0.4)).current;
  const wiggle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makePulse = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1.8, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
          ]),
        ]),
      );

    const wiggleAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1, duration: 120, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.delay(1400),
      ]),
    );

    const a = makePulse(ring1Scale, ring1Opacity, 0);
    const b = makePulse(ring2Scale, ring2Opacity, 800);
    a.start();
    b.start();
    wiggleAnim.start();
    return () => { a.stop(); b.stop(); wiggleAnim.stop(); };
  }, [ring1Scale, ring1Opacity, ring2Scale, ring2Opacity, wiggle]);

  const rotate = wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-15deg', '15deg'] });

  return (
    <View style={{ width: 56, height: 56, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.28)', transform: [{ scale: ring1Scale }], opacity: ring1Opacity }} />
      <Animated.View style={{ position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)', transform: [{ scale: ring2Scale }], opacity: ring2Opacity }} />
      <Animated.View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.28)', justifyContent: 'center', alignItems: 'center', transform: [{ rotate }] }}>
        <Ionicons name="notifications" size={18} color="#fff" />
      </Animated.View>
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
  const p = usePhasePalette();
  return (
    <View style={[s.metricCard, { backgroundColor: p.innerBg, borderColor: p.innerBorder }]}>
      <Text style={[s.metricLabel, { color: accentColor }]}>{label}</Text>
      <Text style={[s.metricValue, { color: p.heading }, smallValue && { fontSize: 16 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {detail ? <Text style={[s.metricDetail, { color: p.textFaint }]}>{detail}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pill button (matches web QueueActionPill)
// ---------------------------------------------------------------------------
function Pill({ label, onPress, tone = 'primary' }: { label: string; onPress: () => void; tone?: 'primary' | 'danger' | 'secondary' }) {
  const { isDark } = useTheme();
  const bg = tone === 'primary'
    ? (isDark ? 'rgba(255,255,255,1)' : '#0f172a')
    : tone === 'danger'
    ? 'rgba(244,63,94,0.15)'
    : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)');
  const border = tone === 'primary'
    ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)')
    : tone === 'danger'
    ? 'rgba(185,28,28,0.35)'
    : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)');
  const textColor = tone === 'primary'
    ? (isDark ? '#0f172a' : '#fff')
    : tone === 'danger'
    ? (isDark ? '#fecdd3' : '#b91c1c')
    : (isDark ? '#fff' : '#0f172a');
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
  const { t } = useTranslation();
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
      <Text style={s.countdownLabel}>{expired ? t('customer.expired') : t('customer.seconds')}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Countdown bar (linear, for called card bottom)
// ---------------------------------------------------------------------------
function CountdownBar({ calledAt }: { calledAt: string }) {
  const { t } = useTranslation();
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
        {remaining === 0 ? t('customer.timesUp') : t('customer.proceedToCounter')}
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
const HISTORY_STATUS_CONFIG: Record<string, { statusKey: string; color: string; icon: string }> = {
  served: { statusKey: 'status.served', color: '#22c55e', icon: 'checkmark-circle' },
  no_show: { statusKey: 'status.missed', color: '#64748b', icon: 'alert-circle' },
  cancelled: { statusKey: 'status.cancelled', color: '#ef4444', icon: 'close-circle' },
  waiting: { statusKey: 'status.waiting', color: '#3b82f6', icon: 'time' },
  called: { statusKey: 'status.called', color: '#f59e0b', icon: 'megaphone' },
  serving: { statusKey: 'status.serving', color: '#f97316', icon: 'pulse' },
};

function HistoryCard({ entry, onPress, colors: c }: { entry: { token: string; ticketNumber: string; officeName: string; serviceName: string; status: string; date: string; officeTimezone?: string | null }; onPress: () => void; colors?: any }) {
  const { t, i18n } = useTranslation();
  const { colors: themeColors } = useTheme();
  const col = c || themeColors;
  const dateStr = formatDate(entry.date, entry.officeTimezone, i18n.language);
  const statusCfg = HISTORY_STATUS_CONFIG[entry.status] ?? HISTORY_STATUS_CONFIG.served;
  return (
    <TouchableOpacity style={[s.historyCard, { backgroundColor: col.surface, borderColor: col.borderLight }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[s.historyCardIcon, { backgroundColor: col.infoLight }]}><Ionicons name="receipt-outline" size={20} color={col.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[s.historyCardTitle, { color: col.text }]} numberOfLines={1}>{entry.officeName}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {entry.ticketNumber ? (
            <Text
              style={{
                fontSize: 11,
                fontWeight: '800',
                color: col.primary,
                backgroundColor: col.primary + '18',
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 4,
                letterSpacing: 0.3,
              }}
              numberOfLines={1}
            >
              {entry.ticketNumber}
            </Text>
          ) : null}
          <Text style={[s.historyCardSub, { color: col.textSecondary, flex: 1 }]} numberOfLines={1}>{entry.serviceName}</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={[s.historyStatusBadge, { backgroundColor: statusCfg.color + '18' }]}>
          <Ionicons name={statusCfg.icon as any} size={12} color={statusCfg.color} />
          <Text style={[s.historyStatusText, { color: statusCfg.color }]}>{t(statusCfg.statusKey)}</Text>
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
function VisitDetailsGrid({ ticket: tk }: { ticket: import('@/lib/api').TicketResponse }) {
  const { t } = useTranslation();
  const p = usePhasePalette();
  const checkedIn = formatTime(tk.created_at, tk.office?.timezone);
  const source = tk.is_remote ? t('customer.remoteJoin') : t('customer.walkInVisit');
  const items: Array<{ label: string; value: string }> = [
    { label: t('customer.checkedIn'), value: checkedIn },
    { label: t('customer.source'), value: source },
  ];
  return (
    <View style={s.detailsGrid}>
      {items.map((item) => (
        <View key={item.label} style={[s.detailsCell, { backgroundColor: p.innerBg, borderColor: p.innerBorder }]}>
          <Text style={[s.detailsCellLabel, { color: p.textMuted }]}>{item.label}</Text>
          <Text style={[s.detailsCellValue, { color: p.text }]} numberOfLines={2}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Customer info card — always shown, fallback to "No intake collected"
// ---------------------------------------------------------------------------
function CustomerInfoCard({ ticket: tk, onColored = false }: { ticket: import('@/lib/api').TicketResponse; onColored?: boolean }) {
  const { t } = useTranslation();
  const p = usePhasePalette();
  const cd = tk.customer_data;
  const [draft, setDraft] = React.useState({ name: cd?.name ?? '', phone: cd?.phone ?? '', email: cd?.email ?? '' });
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const hasData = cd && (cd.name || cd.phone || cd.email);

  // On colored (called) states, keep white-on-color styling. Otherwise use theme.
  const cardBg = onColored ? 'rgba(0,0,0,0.12)' : p.customerCardBg;
  const cardBorder = onColored ? 'rgba(255,255,255,0.18)' : p.customerBorder;
  const divider = onColored ? 'rgba(255,255,255,0.10)' : p.divider;
  const headingColor = onColored ? '#e2e8f0' : p.textSecondary;
  const labelColor = onColored ? '#cbd5e1' : p.textSecondary;
  const valueColor = onColored ? '#ffffff' : p.text;
  const iconColor = onColored ? '#e2e8f0' : p.iconColor;
  const inputBg = onColored ? 'rgba(255,255,255,0.05)' : p.inputBg;
  const inputBorder = onColored ? 'rgba(255,255,255,0.10)' : p.inputBorder;
  const inputText = onColored ? '#f1f5f9' : p.inputText;
  const inputPlaceholder = onColored ? 'rgba(255,255,255,0.55)' : p.inputPlaceholder;
  const placeholderHint = onColored ? 'rgba(255,255,255,0.55)' : p.textMuted;
  const saveBtnBg = saving ? (onColored ? '#334155' : p.innerBg) : p.accent;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${WEB_BASE}/api/tickets/${tk.id}/customer-data`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_data: { ...cd, ...draft } }),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } catch {}
    setSaving(false);
  };

  return (
    <View style={[s.customerCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="person-circle-outline" size={18} color={iconColor} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: headingColor, letterSpacing: 1.5, textTransform: 'uppercase' }}>{t('customer.myInfo')}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 14, gap: 12 }}>
          {[
            { key: 'name', label: t('customer.fullName'), icon: 'person-outline', keyboard: 'default' },
            { key: 'phone', label: t('customer.phoneNumber'), icon: 'call-outline', keyboard: 'phone-pad' },
            { key: 'email', label: t('customer.email'), icon: 'mail-outline', keyboard: 'email-address' },
          ].map(({ key, label, icon, keyboard }) => (
            <View key={key} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name={icon as any} size={13} color={labelColor} />
                <Text style={{ fontSize: 12, color: labelColor, fontWeight: '700', letterSpacing: 1 }}>{label.toUpperCase()}</Text>
              </View>
              <TextInput
                value={draft[key as keyof typeof draft]}
                onChangeText={v => setDraft(d => ({ ...d, [key]: v }))}
                keyboardType={keyboard as any}
                autoCapitalize={key === 'email' ? 'none' : 'words'}
                placeholder={t('customer.enterField', { field: label.toLowerCase() })}
                placeholderTextColor={inputPlaceholder}
                style={{ backgroundColor: inputBg, borderWidth: 1, borderColor: inputBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: inputText }}
              />
            </View>
          ))}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={{ backgroundColor: saveBtnBg, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{saved ? `✓ ${t('common.saved')}` : saving ? t('common.saving') : t('common.save')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!expanded && hasData && (
        <View style={{ marginTop: 10, gap: 6 }}>
          {cd?.name ? <View style={[s.customerRow, { borderTopColor: divider }]}><Ionicons name="person-outline" size={15} color={iconColor} /><Text style={[s.customerLabel, { color: labelColor }]}>{t('customer.fullName')}</Text><Text style={[s.customerValue, { color: valueColor }]}>{cd.name}</Text></View> : null}
          {cd?.phone ? <View style={[s.customerRow, { borderTopColor: divider }]}><Ionicons name="call-outline" size={15} color={iconColor} /><Text style={[s.customerLabel, { color: labelColor }]}>{t('customer.phoneNumber')}</Text><Text style={[s.customerValue, { color: valueColor }]}>{cd.phone}</Text></View> : null}
          {cd?.email ? <View style={[s.customerRow, { borderTopColor: divider }]}><Ionicons name="mail-outline" size={15} color={iconColor} /><Text style={[s.customerLabel, { color: labelColor }]}>{t('customer.email')}</Text><Text style={[s.customerValue, { color: valueColor }]}>{cd.email}</Text></View> : null}
        </View>
      )}
      {!expanded && !hasData && (
        <Text style={{ fontSize: 13, color: placeholderHint, fontStyle: 'italic', marginTop: 8 }}>{t('customer.editInfo')}</Text>
      )}
    </View>
  );
}

// ===========================================================================
// Main screen
// ===========================================================================
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const p = usePhasePalette();
  const {
    activeToken,
    activeTicket,
    setActiveToken,
    setActiveTicket,
    clearActiveTicket,
    history,
    savedAppointments,
    savedPlaces,
    feedbackByTicketId,
    recordFeedback,
  } = useAppStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  // Derive submitted-state from the persisted store so the prompt never
  // reappears after the user has already rated a ticket. Local rating state
  // is only used for the brief moment between tap and server confirmation.
  const [rating, setRating] = useState(0);
  const ticketIdForFeedback = activeTicket?.id ?? null;
  const storedFeedback = ticketIdForFeedback ? feedbackByTicketId[ticketIdForFeedback] : null;
  const ratingSubmitted = !!storedFeedback;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncLabel, setSyncLabel] = useState(t('customer.syncing'));
  const [isOffline, setIsOffline] = useState(false);
  const failCountRef = useRef(0);
  const activeTicketRef = useRef(activeTicket);
  activeTicketRef.current = activeTicket;

  // When the user swipes back to the list while the ticket is still live,
  // suppress the auto-recover effect until they explicitly re-open one from
  // recent visits. Otherwise the effect would instantly put them back on the
  // tracking view and the "back" would feel broken.
  const dismissedRef = useRef(false);

  // Auto-recover an active ticket so the Queue tab always lands on the live
  // view when something is live. Two sources, checked in parallel:
  //   1. Same-day ticket history entries (walk-ins) — refetched via qr_token.
  //   2. Same-day saved appointments (future bookings) — the server now
  //      returns a linked ticket qr_token once staff checks the customer in,
  //      so the Queue tab can auto-switch from "you have an appointment" to
  //      the live called/serving status.
  useEffect(() => {
    if (activeToken) return;
    if (dismissedRef.current) return;
    const TERMINAL_TICKET = new Set(['served', 'no_show', 'cancelled']);
    const TERMINAL_APPT = new Set(['cancelled', 'no_show', 'completed']);
    const todayStr = new Date().toDateString();

    const historyCandidate = history.find((h) => {
      if (!h.token) return false;
      if (TERMINAL_TICKET.has(h.status)) return false;
      return new Date(h.date).toDateString() === todayStr;
    });

    const appointmentCandidates = savedAppointments.filter((a) => {
      if (a.hidden) return false;
      if (TERMINAL_APPT.has(a.status)) return false;
      return new Date(a.scheduledAt).toDateString() === todayStr;
    });

    if (!historyCandidate && appointmentCandidates.length === 0) return;

    let cancelled = false;
    (async () => {
      // 1. Walk-in ticket from history
      if (historyCandidate) {
        const ticket = await fetchTicket(historyCandidate.token);
        if (cancelled) return;
        if (ticket && !TERMINAL_TICKET.has(ticket.status)) {
          setActiveToken(historyCandidate.token);
          setActiveTicket(ticket);
          return;
        }
      }

      // 2. Appointment that has been checked in → promote linked ticket
      for (const appt of appointmentCandidates) {
        const { ticket } = await fetchAppointmentWithTicket(appt.calendarToken);
        if (cancelled) return;
        if (!ticket) continue;
        if (TERMINAL_TICKET.has(ticket.status)) continue;
        // Fetch the full ticket shape (with office/service/department) so the
        // Queue view renders identically to walk-ins.
        const full = await fetchTicket(ticket.qr_token);
        if (cancelled) return;
        if (!full || TERMINAL_TICKET.has(full.status)) continue;
        setActiveToken(ticket.qr_token);
        setActiveTicket(full);
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeToken, history, savedAppointments, setActiveToken, setActiveTicket]);

  // ---- Polling ----
  const poll = useCallback(async () => {
    if (!activeToken) return;
    const ticket = await fetchTicket(activeToken);
    if (!ticket) {
      failCountRef.current += 1;
      if (failCountRef.current >= 2) {
        setIsOffline(true);
        setSyncLabel(t('customer.offline'));
      }
      if (failCountRef.current >= 5 && !activeTicketRef.current) setLoadError(t('customer.ticketInvalid'));
      return;
    }
    failCountRef.current = 0;
    setLoadError(null);
    setIsOffline(false);
    setSyncLabel(t('customer.syncedTime', { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) }));
    if (prevStatusRef.current && prevStatusRef.current !== ticket.status) {
      if (ticket.status === 'called') {
        // Strong multi-burst ring vibration pattern so the customer notices
        // even when the screen is off (Android) or muted. Pattern is
        // [wait, vibrate, wait, vibrate, ...] in ms.
        Vibration.vibrate(
          Platform.OS === 'android'
            ? [0, 500, 250, 500, 250, 500]
            : [0, 500, 500, 500, 500, 500],
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        // Fire a local notification — plays the default alert sound in the
        // foreground (setNotificationHandler has shouldPlaySound: true) and
        // uses the queue-alerts channel's ring pattern on Android.
        Notifications.scheduleNotificationAsync({
          content: {
            title: t('customer.ticketCalledTitle', { defaultValue: 'Your turn!' }),
            body: t('customer.ticketCalledBody', {
              defaultValue: 'Staff is calling you now. Head to the counter.',
            }),
            sound: 'default',
            priority: Notifications.AndroidNotificationPriority.MAX,
            ...(Platform.OS === 'android' ? { channelId: 'queue-alerts' } : {}),
          },
          trigger: null,
        }).catch(() => {});
      } else if (ticket.status === 'serving') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (['served', 'no_show', 'cancelled'].includes(ticket.status)) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
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

  useEffect(() => { setRating(0); }, [activeToken]);

  // When we land on a served ticket, reconcile with the server: if feedback
  // was already submitted (e.g. from another device, or before a reinstall),
  // mirror it into the local store so the prompt stays hidden.
  useEffect(() => {
    const tid = activeTicket?.id;
    if (!tid) return;
    if (activeTicket?.status !== 'served') return;
    if (feedbackByTicketId[tid]) return;
    let cancelled = false;
    (async () => {
      const existing = await fetchFeedback(tid);
      if (cancelled || !existing) return;
      recordFeedback(tid, existing.rating, existing.comment);
    })();
    return () => { cancelled = true; };
  }, [activeTicket?.id, activeTicket?.status, feedbackByTicketId, recordFeedback]);

  const handleStopTracking = async () => {
    const ticketId = activeTicket?.id;
    // Mark the tab as dismissed BEFORE anything else so the auto-recover
    // effect can't re-hydrate the ticket while we're tearing it down.
    dismissedRef.current = true;
    if (ticketId) {
      // Try the authoritative Supabase update first (works when the client
      // has perms). Fall back to the service-role REST endpoint if RLS
      // blocks the direct write — that's what the Next.js route is for.
      let cancelled = false;
      try {
        await cancelTicket(ticketId);
        cancelled = true;
      } catch {
        /* fall through to REST */
      }
      if (!cancelled) {
        const ok = await stopTracking(ticketId);
        if (!ok) {
          Alert.alert(
            t('common.error', { defaultValue: 'Error' }),
            t('customer.endVisitFailed', {
              defaultValue: "Couldn't end the visit. Please try again.",
            }),
          );
          dismissedRef.current = false;
          return;
        }
        // tracking-stop returns ok=true even when the ticket was already
        // terminal. Re-fetch to verify the server really shows the ticket as
        // cancelled — if it doesn't, surface an error instead of silently
        // pretending everything worked.
        const verify = await fetchTicket(activeTicket?.qr_token ?? '').catch(() => null);
        if (verify && !['cancelled', 'served', 'no_show', 'transferred'].includes(verify.status)) {
          Alert.alert(
            t('common.error', { defaultValue: 'Error' }),
            t('customer.endVisitFailed', {
              defaultValue: "Couldn't end the visit. Please try again.",
            }),
          );
          dismissedRef.current = false;
          return;
        }
      } else {
        // We updated the row directly — still fire the REST endpoint so the
        // server can clean up push tokens / live activities.
        stopTracking(ticketId).catch(() => {});
      }
    }
    // Stamp 'cancelled' in history so auto-recover never re-hydrates this on
    // next app launch (even if poll caches stale ticket data).
    clearActiveTicket({ terminalStatus: 'cancelled' });
    prevStatusRef.current = null;
  };
  const confirmEndVisit = () => {
    Alert.alert(
      t('customer.endVisit'),
      t('customer.endVisitMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('customer.endVisitConfirm'), style: 'destructive', onPress: handleStopTracking },
      ],
    );
  };
  // Return to the Active-tab list view without ending the ticket. The ticket
  // stays live in history/DB — tapping its recent-visits card re-opens tracking.
  const backToList = useCallback(() => {
    dismissedRef.current = true;
    setActiveToken(null);
    setActiveTicket(null);
  }, [setActiveToken, setActiveTicket]);

  // Reset the swipe transform whenever the tracking view is (re)shown so a
  // mid-gesture unmount can't leave the next render visually shifted.
  useEffect(() => {
    if (activeToken) swipeAnim.setValue(0);
  }, [activeToken, swipeAnim]);

  // Swipe left (or right, for RTL/edge back) returns to the Active list view.
  const swipeAnim = useRef(new Animated.Value(0)).current;
  const swipePan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, gs) =>
      Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
    onPanResponderMove: (_e, gs) => {
      // Follow the finger on either axis for feedback, capped.
      const capped = Math.max(Math.min(gs.dx * 0.4, 80), -80);
      swipeAnim.setValue(capped);
    },
    onPanResponderRelease: (_e, gs) => {
      if (Math.abs(gs.dx) > 100) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // Snap back to 0 before unmounting so the next render starts clean.
        swipeAnim.setValue(0);
        backToList();
        return;
      }
      Animated.spring(swipeAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
    },
  }), [backToList, swipeAnim]);

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
    const recentHistory = history;
    const UPCOMING = new Set(['pending', 'confirmed', 'checked_in']);
    const nextAppt = [...savedAppointments]
      .filter((a) => !a.hidden && UPCOMING.has(a.status))
      .sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      )[0];
    const pinnedFirst = [...savedPlaces].sort((a, b) => {
      const pinDiff = Number(!!b.isPinned) - Number(!!a.isPinned);
      if (pinDiff !== 0) return pinDiff;
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
    const recentPlaces = pinnedFirst.slice(0, 5);

    const renderNextAppt = () => {
      if (!nextAppt) return null;
      const tz = nextAppt.officeTimezone ?? null;
      const timeStr = formatTime(nextAppt.scheduledAt, tz);
      const dateStr = formatDate(nextAppt.scheduledAt, tz, i18n.language, { weekday: 'short', month: 'short', day: 'numeric' });
      return (
        <TouchableOpacity
          style={[s.apptHero, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push('/(tabs)/history')}
          activeOpacity={0.8}
        >
          <View style={[s.apptHeroIcon, { backgroundColor: colors.primary + '1A' }]}>
            <Ionicons name="calendar" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.apptHeroLabel, { color: colors.textMuted }]}>
              {t('home.nextAppointment', { defaultValue: 'Next appointment' })}
            </Text>
            <Text style={[s.apptHeroTitle, { color: colors.text }]} numberOfLines={1}>
              {nextAppt.ticketNumber ? `${nextAppt.ticketNumber} · ` : ''}
              {nextAppt.businessName}
            </Text>
            <Text style={[s.apptHeroTime, { color: colors.textSecondary }]}>
              {dateStr} · {timeStr}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      );
    };

    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={s.emptyContent}>
        {renderNextAppt()}

        <View style={s.illustrationArea}>
          <View style={[s.illustrationOuter, { backgroundColor: isDark ? 'rgba(59,130,246,0.15)' : colors.primaryLight + '1F' }]}>
            <View style={[s.illustrationMiddle, { backgroundColor: isDark ? 'rgba(59,130,246,0.25)' : colors.primary + '59' }]}>
              <View style={[s.illustrationInner, { backgroundColor: isDark ? 'rgba(59,130,246,0.18)' : colors.surface }]}>
                <Ionicons name="ticket" size={48} color={isDark ? '#60a5fa' : colors.primary} />
              </View>
            </View>
          </View>
        </View>
        <Text style={[s.emptyHeadline, { color: colors.text }]}>{t('customer.joinQueue')}</Text>
        <Text style={[s.emptySubtitle, { color: colors.textSecondary }]}>{t('scan.pointAtQR')}</Text>
        <TouchableOpacity style={[s.scanButton, { backgroundColor: colors.primary, shadowColor: colors.primary }]} onPress={() => router.push('/scan' as any)} activeOpacity={0.8}>
          <Ionicons name="qr-code-outline" size={22} color="#fff" /><Text style={s.scanButtonText}>{t('scan.scanQR')}</Text>
        </TouchableOpacity>
        {!showManualEntry ? (
          <TouchableOpacity onPress={() => setShowManualEntry(true)} activeOpacity={0.6}><Text style={[s.manualLink, { color: colors.textMuted }]}>{t('scan.enterManually')}</Text></TouchableOpacity>
        ) : (
          <View style={s.manualBox}>
            <TextInput style={[s.manualInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} placeholder={t('customer.pasteCode')} placeholderTextColor={colors.textMuted} value={manualCode} onChangeText={setManualCode} autoCapitalize="none" autoCorrect={false} returnKeyType="go" onSubmitEditing={handleManualSubmit} />
            <TouchableOpacity style={[s.manualGo, { backgroundColor: colors.primary }, !manualCode.trim() && { backgroundColor: colors.textMuted }]} onPress={handleManualSubmit} disabled={!manualCode.trim()}><Ionicons name="arrow-forward" size={20} color="#fff" /></TouchableOpacity>
          </View>
        )}

        {recentPlaces.length > 0 && (
          <View style={s.recentPlacesSection}>
            <View style={s.recentPlacesHeader}>
              <Text style={[s.recentTitle, { color: colors.textMuted }]}>
                {t('home.recentPlaces', { defaultValue: 'Recent places' })}
              </Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/places')}>
                <Text style={[s.recentSeeAll, { color: colors.primary }]}>
                  {t('common.seeAll', { defaultValue: 'See all' })}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 2 }}>
              {recentPlaces.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[s.placeChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (p.kioskSlug) router.push(`/queue-peek/${p.kioskSlug}` as any);
                    else router.push('/(tabs)/places');
                  }}
                >
                  <View style={[s.placeChipIcon, { backgroundColor: colors.primary + '1A' }]}>
                    <Ionicons name="storefront" size={16} color={colors.primary} />
                  </View>
                  <Text style={[s.placeChipName, { color: colors.text }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {recentHistory.length > 0 && (
          <View style={s.recentSection}>
            <Text style={[s.recentTitle, { color: colors.textMuted }]}>{t('customer.recentVisits')}</Text>
            {recentHistory.map((e) => (
              <HistoryCard
                key={e.token}
                entry={e}
                onPress={() => {
                  dismissedRef.current = false;
                  setActiveToken(e.token);
                }}
                colors={colors}
              />
            ))}
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
          <Text style={[s.errorTitle, { color: colors.text }]}>{t('customer.ticketNotFound')}</Text>
          <Text style={[s.errorSub, { color: colors.textSecondary }]}>{loadError}</Text>
          <View style={{ gap: 10, marginTop: 16, width: '100%', maxWidth: 260 }}>
            <TouchableOpacity style={[s.retryBtn, { backgroundColor: colors.primary }]} onPress={() => { failCountRef.current = 0; setLoadError(null); poll(); }} activeOpacity={0.7}>
              <Ionicons name="refresh" size={18} color="#fff" /><Text style={s.retryBtnText}>{t('customer.retry')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.dismissBtn, { borderColor: colors.border }]} onPress={() => { setActiveToken(null); setActiveTicket(null); setLoadError(null); failCountRef.current = 0; }} activeOpacity={0.7}>
              <Text style={[s.dismissBtnText, { color: colors.textSecondary }]}>{t('customer.goBack')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return <View style={[s.centerScreen, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /><Text style={{ fontSize: 15, color: colors.textSecondary }}>{t('customer.loadingTicket')}</Text></View>;
  }

  // =======================================================================
  // Derived state
  // =======================================================================
  const tk = activeTicket;
  const isWaiting = tk.status === 'waiting';
  const isCalled = tk.status === 'called';
  const isServing = tk.status === 'serving';
  const isTerminal = ['served', 'no_show', 'cancelled'].includes(tk.status);
  const serviceLabel = tk.service?.name ?? tk.department?.name ?? '';
  const officeName = tk.office?.name ?? t('customer.queue');
  const peopleAhead = tk.position != null && tk.position > 0 ? tk.position - 1 : 0;
  const positionText = tk.position ? (tk.position === 1 ? t('customer.youreNext') : tk.position <= 3 ? t('customer.almostThere') : `${peopleAhead} ${t('customer.ahead')}`) : '--';
  const deskName = tk.desk?.name ?? t('customer.yourDesk');

  // =======================================================================
  // CALLED STATE — gradient background, bell, countdown circle, info card
  // Matches web your-turn.tsx exactly
  // =======================================================================
  if (isCalled) {
    const remaining = tk.called_at ? Math.max(0, CALL_WAIT_SECONDS - Math.floor((Date.now() - new Date(tk.called_at).getTime()) / 1000)) : CALL_WAIT_SECONDS;
    const phase = remaining > 30 ? 'green' : remaining > 10 ? 'yellow' : 'red';
    const bgColor = phase === 'green' ? '#1a6f49' : phase === 'yellow' ? '#b97613' : '#8e1f1f';

    return (
      <Animated.View style={{ flex: 1, transform: [{ translateX: swipeAnim }] }} {...swipePan.panHandlers}>
      <ScrollView
        style={{ flex: 1, backgroundColor: bgColor }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 10, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="rgba(255,255,255,0.6)" />}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        {/* Compact header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity
            onPress={backToList}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
            accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
          >
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 1.2, textTransform: 'uppercase' }} numberOfLines={1}>{officeName}</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.7)' }}>{tk.ticket_number}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pill label={t('customer.refresh')} onPress={handleRefresh} tone="primary" />
            <Pill label={t('customer.end')} onPress={confirmEndVisit} tone="danger" />
          </View>
        </View>

        {/* Hero: centered countdown, bell parked in top-right corner */}
        <View style={{ alignItems: 'center', gap: 8, marginTop: 4 }}>
          {/* Countdown centered */}
          {tk.called_at && <CountdownCircle calledAt={tk.called_at} />}

          <Text style={{ fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center', letterSpacing: -0.3, marginTop: 6 }} numberOfLines={2}>
            {t('customer.goToDesk', { desk: deskName })}
          </Text>

          {(tk.recall_count ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.18)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 9999 }}>
              <Ionicons name="refresh" size={12} color="#fff" />
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>{t('customer.recalledCount', { count: tk.recall_count })}</Text>
            </View>
          )}

          {/* Bell — small, animated, fixed in the top-right corner of the hero area */}
          <View pointerEvents="none" style={{ position: 'absolute', top: -4, right: 4 }}>
            <AnimatedBell />
          </View>
        </View>

        {/* Info card — dropped "What to do" row; time is self-evident from countdown */}
        <View style={s.infoCard}>
          <InfoRow icon="location-outline" label={t('customer.whereToGo')} value={deskName} />
          <InfoRow icon="document-text-outline" label={t('customer.whatToShow')} value={`${t('customer.ticket')} ${tk.ticket_number}`} />
        </View>

        <CustomerInfoCard ticket={tk} onColored />
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
        style={[s.darkBg, { backgroundColor: p.bg }]}
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={p.refreshTint} />}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.businessName, { color: p.title }]}>{officeName}</Text>
            {serviceLabel ? <Text style={[s.branchLabel, { color: p.textMuted }]}>{serviceLabel}</Text> : null}
            <Text style={[s.syncText, { color: p.textFaint }]}>{syncLabel}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <Pill label={t('customer.refresh')} onPress={handleRefresh} tone="secondary" />
            <Pill label={t('customer.end')} onPress={confirmEndVisit} tone="danger" />
          </View>
        </View>

        {/* Main card — compact: single status title, ticket + desk inline, timer */}
        <View style={[s.mainCard, { backgroundColor: p.cardBg, borderColor: p.cardBorder }]}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(56,189,248,0.12)', justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="people" size={32} color="#7dd3fc" />
          </View>
          <Text style={{ fontSize: 24, fontWeight: '800', color: p.heading, textAlign: 'center', letterSpacing: -0.3 }}>{t('customer.beingServed')}</Text>

          <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
            <MetricCard label={t('customer.ticket')} value={tk.ticket_number} detail="" accentColor="#7dd3fc" />
            <MetricCard label={t('customer.desk')} value={deskName} detail="" accentColor="#34d399" />
          </View>

          {tk.serving_started_at && (
            <View style={{ alignItems: 'center', marginTop: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: p.textFaint, letterSpacing: 1.5, textTransform: 'uppercase' }}>{t('customer.sessionTime')}</Text>
              <ElapsedTimer since={tk.serving_started_at} />
            </View>
          )}
        </View>

        <CustomerInfoCard ticket={tk} />
      </ScrollView>
      </Animated.View>
    );
  }

  // =======================================================================
  // TERMINAL STATES — served (feedback), no_show, cancelled
  // Matches web feedback-form.tsx / queue-session-ended.tsx
  // =======================================================================
  if (isTerminal) {
    const iconName = tk.status === 'served' ? 'checkmark-circle' : tk.status === 'no_show' ? 'alert-circle' : 'close-circle';
    const iconColor = tk.status === 'served' ? '#4ade80' : tk.status === 'no_show' ? '#fbbf24' : '#f87171';
    const title = tk.status === 'served' ? t('customer.visitComplete') : tk.status === 'no_show' ? t('customer.missed') : t('customer.cancelled');
    const description = tk.status === 'served' ? t('customer.thanksForVisiting') : tk.status === 'no_show' ? t('customer.missedMsg') : t('customer.cancelledMsg');

    return (
      <ScrollView style={[s.darkBg, { backgroundColor: p.bg }]} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text style={[s.businessName, { color: p.title }]}>{officeName}</Text>
        </View>

        <View style={[s.mainCard, { gap: 16, backgroundColor: p.cardBg, borderColor: p.cardBorder }]}>
          <Ionicons name={iconName as any} size={56} color={iconColor} />
          <Text style={{ fontSize: 24, fontWeight: '700', color: p.heading, textAlign: 'center' }}>{title}</Text>
          <Text style={{ fontSize: 14, color: p.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 280 }}>{description}</Text>
          <Text style={{ fontSize: 13, color: p.textFaint, fontWeight: '600' }}>{t('customer.ticket')} {tk.ticket_number}</Text>

          {tk.status === 'served' && (
            <View style={{ alignItems: 'center', gap: 8, marginTop: 4 }}>
              {!ratingSubmitted ? (
                <>
                  <Text style={{ fontSize: 15, color: p.textMuted }}>{t('customer.rateExperience')}</Text>
                  <StarRating rating={rating} onRate={(n) => {
                    setRating(n);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    // Optimistically persist locally so the prompt hides
                    // immediately even if the network call is slow or fails.
                    recordFeedback(tk.id, n, null);
                    submitFeedback({
                      ticketId: tk.id,
                      serviceId: tk.service_id,
                      staffId: null,
                      rating: n,
                    }).catch(() => {});
                  }} />
                </>
              ) : (
                <Text style={{ fontSize: 15, color: '#4ade80', fontWeight: '600' }}>{t('customer.thanksFeedback')}</Text>
              )}
            </View>
          )}

          <TouchableOpacity
            onPress={() => {
              // Terminal state — the ticket is already closed server-side.
              // Clear local tracking and bounce the customer back to the
              // Places main menu so they can start a new visit.
              clearActiveTicket();
              prevStatusRef.current = null;
              router.replace('/(tabs)/places' as any);
            }}
            activeOpacity={0.8}
            style={{ alignItems: 'center', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 9999, backgroundColor: p.accent, width: '100%', marginTop: 8 }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
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
      style={[s.darkBg, { backgroundColor: p.bg }]}
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={p.refreshTint} />}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      {/* Header: business name, sync, status badge, action pills */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <TouchableOpacity
          onPress={backToList}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' }}
          accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
        >
          <Ionicons name="chevron-back" size={20} color={p.textSecondary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.businessName, { color: p.title }]} numberOfLines={1}>{officeName}</Text>
          {serviceLabel ? <Text style={[s.branchLabel, { color: p.textMuted }]}>{serviceLabel}</Text> : null}
          <Text style={[s.syncText, { color: p.textFaint }]}>{syncLabel}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <View style={{ backgroundColor: isDark ? 'rgba(251,191,36,0.15)' : '#fef3c7', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 9999 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#fde68a' : '#92400e', letterSpacing: 1.5 }}>{t('customer.inQueue').toUpperCase()}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill label={t('customer.refresh')} onPress={handleRefresh} tone="secondary" />
            <Pill label={t('customer.end')} onPress={confirmEndVisit} tone="danger" />
          </View>
        </View>
      </View>

      {/* Main ticket card */}
      <View style={[s.mainCard, { backgroundColor: p.cardBg, borderColor: p.cardBorder }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, width: '100%' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: p.textFaint, letterSpacing: 2, textTransform: 'uppercase' }}>{t('customer.ticket')}</Text>
            <Text style={{ fontSize: 36, fontWeight: '900', color: p.heading, letterSpacing: 1, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>{tk.ticket_number}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 48, fontWeight: '700', color: tk.position === 1 ? '#10b981' : p.heading, lineHeight: 52 }}>{tk.position ? `#${tk.position}` : '--'}</Text>
            <Text style={{ fontSize: 13, color: tk.position === 1 ? '#10b981' : (isDark ? 'rgba(34,211,238,0.7)' : colors.primary), fontWeight: tk.position === 1 ? '700' : '400', marginTop: 4 }}>{positionText}</Text>
          </View>
        </View>

        {/* Queue progress */}
        <View style={{ gap: 8, width: '100%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <PulsingDot color={isDark ? '#22d3ee' : colors.primary} />
              <Text style={{ fontSize: 11, fontWeight: '600', color: p.textFaint, letterSpacing: 1.2, textTransform: 'uppercase' }}>{t('customer.queueProgress')}</Text>
            </View>
            <Text style={{ fontSize: 11, fontWeight: '600', color: tk.position === 1 ? '#10b981' : (isDark ? '#34d399' : colors.success), letterSpacing: 1.2 }}>
              {tk.position ? `#${tk.position} ${t('customer.inQueue')}` : '--'}
            </Text>
          </View>
          <ProgressBar position={tk.position} />
        </View>
      </View>

      {/* 2 Metric cards — est wait + now serving. Alerts live in the banner below. */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <MetricCard
          label={t('customer.estWait')}
          value={tk.position === 1 ? t('time.anyMoment') : tk.estimated_wait_minutes != null ? `${tk.estimated_wait_minutes} ${t('time.min')}` : '--'}
          detail={tk.position === 1 ? '' : tk.estimated_wait_minutes != null ? t('customer.approximateTiming') : t('customer.calculatingTime')}
          accentColor="#38bdf8"
        />
        <MetricCard
          label={t('customer.nowServing')}
          value={tk.now_serving ?? '--'}
          detail=""
          accentColor="#34d399"
          smallValue
        />
      </View>

      {/* Minimal visit meta — just checked-in time + source. Service already in header. */}
      <View style={s.detailsGrid}>
        <View style={[s.detailsCell, { backgroundColor: p.innerBg, borderColor: p.innerBorder }]}>
          <Text style={[s.detailsCellLabel, { color: p.textMuted }]}>{t('customer.checkedIn')}</Text>
          <Text style={[s.detailsCellValue, { color: p.text }]}>
            {formatTime(tk.created_at, tk.office?.timezone)}
          </Text>
        </View>
        <View style={[s.detailsCell, { backgroundColor: p.innerBg, borderColor: p.innerBorder }]}>
          <Text style={[s.detailsCellLabel, { color: p.textMuted }]}>{t('customer.source')}</Text>
          <Text style={[s.detailsCellValue, { color: p.text }]}>
            {tk.is_remote ? t('customer.remoteJoin') : t('customer.walkInVisit')}
          </Text>
        </View>
      </View>

      {/* Customer info card — always shown */}
      <CustomerInfoCard ticket={tk} />

      {/* Alerts enabled banner */}
      <View style={[s.alertsBanner, { borderColor: p.innerBorder, backgroundColor: p.innerBg }]}>
        <Ionicons name="notifications-outline" size={16} color={isDark ? '#34d399' : colors.success} />
        <Text style={{ fontSize: 13, fontWeight: '500', color: p.textSecondary, flex: 1 }}>{t('customer.alertsEnabled')}</Text>
      </View>
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

  // Home extras — next appointment hero + recent-places chips
  apptHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  apptHeroIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  apptHeroLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
  apptHeroTitle: { fontSize: 15, fontWeight: '700' },
  apptHeroTime: { fontSize: 13, marginTop: 2 },
  recentPlacesSection: { marginTop: 28, width: '100%' },
  recentPlacesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  recentSeeAll: { fontSize: 13, fontWeight: '600' },
  placeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 200,
  },
  placeChipIcon: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  placeChipName: { fontSize: 14, fontWeight: '600', flexShrink: 1 },


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
  customerCard: { backgroundColor: 'rgba(15,23,42,0.35)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', padding: 16 },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' },
  customerLabel: { fontSize: 13, color: '#cbd5e1', fontWeight: '600', width: 90 },
  customerValue: { fontSize: 14, fontWeight: '700', color: '#ffffff', flex: 1 },

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
  footer: { fontSize: 11, fontWeight: '600', color: '#000000', letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center', marginTop: 'auto', paddingTop: 16 },
});
