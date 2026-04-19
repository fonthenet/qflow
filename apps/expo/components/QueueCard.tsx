import { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { CountdownTimer } from './CountdownTimer';
import type { TicketResponse } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { API_BASE_URL } from '@/lib/config';

// ---------------------------------------------------------------------------
// Spacing / sizing constants (layout only — no colors)
// ---------------------------------------------------------------------------

const sp = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
const fs = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 28 };
const br = { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 };

// ---------------------------------------------------------------------------
// Per-theme palette
// ---------------------------------------------------------------------------

interface Palette {
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  emerald: string;
  calledOrange: string;
  red: string;
  green: string;
  progressTrack: string;
  progressFill: string;
  metricBg: string;
  metricBorder: string;
  sectionBg: string;
}

const darkPalette: Palette = {
  cardBg: '#0f172a',
  cardBorder: 'rgba(255,255,255,0.08)',
  textPrimary: '#ffffff',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  accent: '#22d3ee',
  emerald: '#34d399',
  calledOrange: '#fb923c',
  red: '#f87171',
  green: '#4ade80',
  progressTrack: 'rgba(255,255,255,0.08)',
  progressFill: '#22d3ee',
  metricBg: 'rgba(255,255,255,0.06)',
  metricBorder: 'rgba(255,255,255,0.10)',
  sectionBg: 'rgba(255,255,255,0.04)',
};

const lightPalette: Palette = {
  cardBg: '#ffffff',
  cardBorder: '#e2e8f0',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  accent: '#3b82f6',
  emerald: '#16a34a',
  calledOrange: '#d97706',
  red: '#dc2626',
  green: '#16a34a',
  progressTrack: '#e2e8f0',
  progressFill: '#3b82f6',
  metricBg: '#f8fafc',
  metricBorder: '#e2e8f0',
  sectionBg: '#f8fafc',
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusAccent(status: string, t: Palette): string {
  switch (status) {
    case 'waiting':  return t.accent;
    case 'called':   return t.calledOrange;
    case 'serving':  return t.emerald;
    case 'served':   return t.green;
    case 'no_show':  return '#f59e0b';
    case 'cancelled':return t.red;
    default:         return t.accent;
  }
}

// ---------------------------------------------------------------------------
// PulseDot
// ---------------------------------------------------------------------------

function PulseDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [scale, opacity]);

  return (
    <View style={pulse.container}>
      <Animated.View style={[pulse.ring, { borderColor: color, transform: [{ scale }], opacity }]} />
      <View style={[pulse.dot, { backgroundColor: color }]} />
    </View>
  );
}

const pulse = StyleSheet.create({
  container: { width: 16, height: 16, justifyContent: 'center', alignItems: 'center' },
  ring: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

// ---------------------------------------------------------------------------
// PulsingBorder
// ---------------------------------------------------------------------------

function PulsingBorder({ color, children }: { color: string; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{ borderWidth: 2, borderColor: color, borderRadius: br.lg, overflow: 'hidden' as const, opacity }}
    >
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// ElapsedTimer
// ---------------------------------------------------------------------------

function ElapsedTimer({ since, color }: { since: string; color: string }) {
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    const sinceMs = new Date(since).getTime();
    const update = () => {
      const diff = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [since]);

  return (
    <Text style={[layout.elapsedTime, { color }]}>{elapsed}</Text>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

function ProgressBar({ position, t }: { position: number | null; t: Palette }) {
  const pos = position ?? 1;
  const progress = Math.max(0.08, Math.min(0.92, (14 - Math.min(pos, 14)) / 14));
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, { toValue: progress, duration: 800, useNativeDriver: false }).start();
  }, [progress, widthAnim]);

  return (
    <View style={[layout.progressTrack, { backgroundColor: t.progressTrack }]}>
      <Animated.View
        style={[
          layout.progressFill,
          {
            backgroundColor: t.progressFill,
            width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

function MetricCard({
  icon,
  value,
  label,
  t,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string | number;
  label: string;
  t: Palette;
}) {
  return (
    <View style={[layout.metricCard, { backgroundColor: t.metricBg, borderColor: t.metricBorder }]}>
      <Ionicons name={icon} size={18} color={t.accent} style={{ marginBottom: sp.xs }} />
      <Text style={[layout.metricValue, { color: t.textPrimary }]}>{value}</Text>
      <Text style={[layout.metricLabel, { color: t.textMuted }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// QueueCard
// ---------------------------------------------------------------------------

export function QueueCard({ ticket, onTicketUpdated }: { ticket: TicketResponse; onTicketUpdated?: () => void }) {
  const { t: tr } = useTranslation();
  const { isDark } = useTheme();
  const t = isDark ? darkPalette : lightPalette;

  // Edit state
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState(ticket.customer_data?.name ?? '');
  const [editPhone, setEditPhone] = useState(ticket.customer_data?.phone ?? '');
  const [editReason, setEditReason] = useState(ticket.customer_data?.reason ?? ticket.customer_data?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const saveEdit = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/ticket-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: ticket.qr_token,
          name: editName.trim(),
          phone: editPhone.trim(),
          reason: editReason.trim(),
        }),
      });
      if (res.ok) {
        setEditVisible(false);
        onTicketUpdated?.();
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.error ?? tr('customer.failedToSave'));
      }
    } catch {
      setSaveError(tr('customer.networkError'));
    } finally {
      setSaving(false);
    }
  };

  const isWaiting  = ticket.status === 'waiting';
  const isCalled   = ticket.status === 'called';
  const isServing  = ticket.status === 'serving';
  const isTerminal = ['served', 'no_show', 'cancelled'].includes(ticket.status);
  const isNext = isWaiting && ticket.position === 1;

  // Flashing animation for "You're Next!"
  const flashAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isNext) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isNext, flashAnim]);

  const accentColor = statusAccent(ticket.status, t);
  const serviceLabel = ticket.service?.name ?? ticket.department?.name ?? null;
  const peopleAhead = ticket.position != null && ticket.position > 0 ? ticket.position - 1 : 0;
  const syncedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  let completedDurationMin: number | null = null;
  if (ticket.status === 'served' && ticket.completed_at && ticket.created_at) {
    completedDurationMin = Math.round(
      (new Date(ticket.completed_at).getTime() - new Date(ticket.created_at).getTime()) / 60000
    );
  }

  return (
    <View
      style={[
        layout.card,
        {
          backgroundColor: t.cardBg,
          borderColor: t.cardBorder,
          shadowColor: isDark ? '#000' : '#64748b',
        },
      ]}
    >
      {/* Header */}
      <View style={layout.header}>
        <View style={{ flex: 1 }}>
          {serviceLabel && (
            <Text style={[layout.serviceLabel, { color: t.textMuted }]}>{serviceLabel}</Text>
          )}
          <Text style={[layout.ticketNumber, { color: t.textPrimary }]}>
            {ticket.ticket_number}
          </Text>
        </View>
        {isWaiting && ticket.position != null && (
          <View
            style={[
              layout.positionBadge,
              {
                backgroundColor: isNext ? '#10b98120' : t.accent + '20',
                borderColor: isNext ? '#10b98150' : t.accent + '50',
              },
            ]}
          >
            <Text style={[layout.positionBadgeText, { color: isNext ? '#10b981' : t.accent }]}>
              #{ticket.position}
            </Text>
          </View>
        )}
      </View>

      {/* WAITING */}
      {isWaiting && (
        <>
          <View style={layout.progressSection}>
            <View style={layout.progressLabelRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <PulseDot color={ticket.position === 1 ? '#10b981' : t.accent} />
                <Text style={[layout.progressLabelText, { color: ticket.position === 1 ? '#10b981' : t.textSecondary }]}>
                  {ticket.position === 1 ? tr('customer.getReady') : ticket.position != null && ticket.position <= 3 ? tr('customer.almostThere') : tr('customer.inQueue')}
                </Text>
              </View>
              <Text style={[layout.progressPosition, { color: t.textMuted }]}>
                {ticket.position === 1 ? tr('customer.getReady') : `#${ticket.position ?? '-'} of ${(ticket.position ?? 0) + peopleAhead + 1}`}
              </Text>
            </View>
            <ProgressBar position={ticket.position} t={t} />
          </View>

          {isNext && (
            <Animated.View style={{
              backgroundColor: '#10b98118',
              borderRadius: br.lg,
              padding: sp.md,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#10b98130',
              opacity: flashAnim,
            }}>
              <Ionicons name="checkmark-circle" size={28} color="#10b981" />
              <Text style={{ color: '#10b981', fontSize: fs.lg, fontWeight: '800', marginTop: sp.xs }}>
                {tr('customer.youreNext')}
              </Text>
              <Text style={{ color: t.textSecondary, fontSize: fs.sm, marginTop: 2 }}>
                {tr('customer.getReadyMsg')}
              </Text>
            </Animated.View>
          )}

          <View style={layout.metricsRow}>
            <MetricCard
              icon="time-outline"
              value={ticket.position === 1 ? tr('time.anyMoment') : ticket.estimated_wait_minutes != null ? `${ticket.estimated_wait_minutes}m` : '--'}
              label={ticket.position === 1 ? tr('time.anyMoment') : tr('customer.estWait')}
              t={t}
            />
            <MetricCard
              icon="list-outline"
              value={ticket.position != null ? `#${ticket.position}` : '--'}
              label={tr('customer.position')}
              t={t}
            />
            <MetricCard
              icon="people-outline"
              value={peopleAhead}
              label={peopleAhead === 0 ? tr('customer.noOneAhead') : tr('customer.ahead')}
              t={t}
            />
          </View>

          <View style={layout.syncRow}>
            <Ionicons name="sync-outline" size={12} color={t.textMuted} />
            <Text style={[layout.syncText, { color: t.textMuted }]}>{tr('customer.syncedTime', { time: syncedAt })}</Text>
          </View>

          <TouchableOpacity
            style={[layout.editButton, { borderColor: t.cardBorder }]}
            onPress={() => {
              setEditName(ticket.customer_data?.name ?? '');
              setEditPhone(ticket.customer_data?.phone ?? '');
              setEditReason(ticket.customer_data?.reason ?? ticket.customer_data?.notes ?? '');
              setSaveError('');
              setEditVisible(true);
            }}
          >
            <Ionicons name="pencil-outline" size={14} color={t.textMuted} />
            <Text style={[layout.editButtonText, { color: t.textMuted }]}>{tr('customer.editInfo')}</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Edit Modal */}
      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={layout.modalOverlay}>
            <View style={[layout.modalCard, { backgroundColor: t.cardBg, borderColor: t.cardBorder }]}>
              <Text style={[layout.modalTitle, { color: t.textPrimary }]}>{tr('customer.editVisitInfo')}</Text>

              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={[layout.modalLabel, { color: t.textSecondary }]}>{tr('customer.fullName')}</Text>
                <TextInput
                  style={[layout.modalInput, { color: t.textPrimary, borderColor: t.cardBorder, backgroundColor: t.metricBg }]}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder={tr('customer.yourName')}
                  placeholderTextColor={t.textMuted}
                  returnKeyType="next"
                  autoCapitalize="words"
                />

                <Text style={[layout.modalLabel, { color: t.textSecondary }]}>{tr('customer.phoneNumber')}</Text>
                <TextInput
                  style={[layout.modalInput, { color: t.textPrimary, borderColor: t.cardBorder, backgroundColor: t.metricBg }]}
                  value={editPhone}
                  onChangeText={setEditPhone}
                  placeholder={tr('customer.yourPhone')}
                  placeholderTextColor={t.textMuted}
                  keyboardType="phone-pad"
                  returnKeyType="next"
                />

                <Text style={[layout.modalLabel, { color: t.textSecondary }]}>{tr('customer.reasonForVisit')}</Text>
                <TextInput
                  style={[layout.modalInput, layout.modalTextArea, { color: t.textPrimary, borderColor: t.cardBorder, backgroundColor: t.metricBg }]}
                  value={editReason}
                  onChangeText={setEditReason}
                  placeholder={tr('customer.reasonPlaceholder')}
                  placeholderTextColor={t.textMuted}
                  multiline
                  numberOfLines={3}
                  returnKeyType="done"
                />

                {saveError ? (
                  <Text style={{ color: t.red, fontSize: fs.sm, marginTop: sp.xs }}>{saveError}</Text>
                ) : null}
              </ScrollView>

              <View style={layout.modalButtons}>
                <TouchableOpacity style={[layout.modalCancel, { borderColor: t.cardBorder }]} onPress={() => setEditVisible(false)}>
                  <Text style={[layout.modalCancelText, { color: t.textSecondary }]}>{tr('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[layout.modalSave, { backgroundColor: t.accent }]} onPress={saveEdit} disabled={saving}>
                  <Text style={layout.modalSaveText}>{saving ? tr('common.saving') : tr('common.save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* CALLED */}
      {isCalled && ticket.called_at && (
        <PulsingBorder color={t.calledOrange}>
          <View style={[layout.calledSection, { backgroundColor: t.calledOrange + '12' }]}>
            <Ionicons name="notifications" size={36} color={t.calledOrange} />
            <Text style={[layout.calledTitle, { color: t.calledOrange }]}>{tr('customer.itsYourTurn')}</Text>
            {ticket.desk && (
              <Text style={[layout.deskText, { color: t.textPrimary }]}>{tr('customer.goToDesk', { desk: ticket.desk.name })}</Text>
            )}
            <CountdownTimer calledAt={ticket.called_at} />
          </View>
        </PulsingBorder>
      )}

      {/* SERVING */}
      {isServing && (
        <View style={[layout.servingSection, { backgroundColor: t.emerald + '12' }]}>
          <Ionicons name="checkmark-circle" size={40} color={t.emerald} />
          <Text style={[layout.servingTitle, { color: t.emerald }]}>{tr('customer.beingServed')}</Text>
          {ticket.desk && (
            <Text style={[layout.servingSubtitle, { color: t.textSecondary }]}>
              {tr('customer.atDesk', { desk: ticket.desk.name })}
            </Text>
          )}
          {ticket.serving_started_at && (
            <ElapsedTimer since={ticket.serving_started_at} color={t.emerald} />
          )}
        </View>
      )}

      {/* TERMINAL */}
      {isTerminal && (
        <View style={[layout.terminalSection, { backgroundColor: t.sectionBg }]}>
          <Ionicons
            name={
              ticket.status === 'served'
                ? 'checkmark-circle'
                : ticket.status === 'no_show'
                  ? 'alert-circle'
                  : 'close-circle'
            }
            size={40}
            color={accentColor}
          />
          <Text style={[layout.terminalTitle, { color: accentColor }]}>
            {ticket.status === 'served'
              ? tr('customer.visitComplete')
              : ticket.status === 'no_show'
                ? tr('customer.missed')
                : tr('customer.cancelled')}
          </Text>
          {completedDurationMin != null && (
            <Text style={[layout.terminalDuration, { color: t.textMuted }]}>
              {tr('customer.completedIn', { min: completedDurationMin })}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Layout-only styles (no hardcoded colors)
// ---------------------------------------------------------------------------

const layout = StyleSheet.create({
  card: {
    borderRadius: br.xl,
    borderWidth: 1,
    padding: sp.lg,
    gap: sp.md,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  serviceLabel: {
    fontSize: fs.sm,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: sp.xs,
  },
  ticketNumber: { fontSize: 38, fontWeight: '800', letterSpacing: -0.5 },
  positionBadge: {
    borderRadius: br.full,
    paddingHorizontal: sp.md,
    paddingVertical: sp.sm,
    borderWidth: 1,
  },
  positionBadgeText: { fontSize: fs.lg, fontWeight: '700' },

  // Progress
  progressSection: { gap: sp.sm },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabelText: { fontSize: fs.sm, fontWeight: '600' },
  progressPosition: { fontSize: fs.xs },
  progressTrack: { height: 6, borderRadius: br.full, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: br.full },

  // Metrics
  metricsRow: { flexDirection: 'row', gap: sp.sm },
  metricCard: {
    flex: 1,
    borderRadius: br.md,
    borderWidth: 1,
    paddingVertical: sp.md,
    paddingHorizontal: sp.sm,
    alignItems: 'center',
  },
  metricValue: { fontSize: fs.xl, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: fs.xs, marginTop: 2, fontWeight: '500' },

  // Sync
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.xs },
  syncText: { fontSize: fs.xs },

  // Called
  calledSection: { padding: sp.lg, alignItems: 'center', gap: sp.sm },
  calledTitle: { fontSize: fs.xl, fontWeight: '700' },
  deskText: { fontSize: fs.lg, fontWeight: '600' },

  // Serving
  servingSection: { borderRadius: br.lg, padding: sp.lg, alignItems: 'center', gap: sp.sm },
  servingTitle: { fontSize: fs.xl, fontWeight: '700' },
  servingSubtitle: { fontSize: fs.md },
  elapsedTime: { fontSize: fs.xxl, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: sp.xs },

  // Terminal
  terminalSection: { borderRadius: br.lg, padding: sp.lg, alignItems: 'center', gap: sp.sm },
  terminalTitle: { fontSize: fs.xl, fontWeight: '700' },
  terminalDuration: { fontSize: fs.sm },

  // Edit button
  editButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: sp.xs, paddingVertical: sp.sm, borderRadius: br.md,
    borderWidth: 1,
  },
  editButtonText: { fontSize: fs.xs, fontWeight: '500' },

  // Edit modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: br.xl, borderTopRightRadius: br.xl,
    borderWidth: 1, padding: sp.lg, gap: sp.md,
  },
  modalTitle: { fontSize: fs.lg, fontWeight: '700', marginBottom: sp.xs },
  modalLabel: { fontSize: fs.sm, fontWeight: '500', marginBottom: 2 },
  modalInput: {
    borderWidth: 1, borderRadius: br.md,
    paddingHorizontal: sp.md, paddingVertical: sp.sm,
    fontSize: fs.md, marginBottom: sp.md,
  },
  modalTextArea: {
    height: 80, textAlignVertical: 'top',
  },
  modalButtons: { flexDirection: 'row', gap: sp.sm, marginTop: sp.xs },
  modalCancel: {
    flex: 1, paddingVertical: sp.md, borderRadius: br.md,
    borderWidth: 1, alignItems: 'center',
  },
  modalCancelText: { fontSize: fs.md, fontWeight: '600' },
  modalSave: {
    flex: 1, paddingVertical: sp.md, borderRadius: br.md, alignItems: 'center',
  },
  modalSaveText: { fontSize: fs.md, fontWeight: '600', color: '#fff' },
});
