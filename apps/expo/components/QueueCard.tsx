import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CountdownTimer } from './CountdownTimer';
import type { TicketResponse } from '@/lib/api';

// ---------------------------------------------------------------------------
// Theme constants (self-contained dark theme)
// ---------------------------------------------------------------------------

const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
const fontSize = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 28, hero: 48 };
const borderRadius = { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 };

const dark = {
  cardBg: '#0f172a',
  cardBorder: 'rgba(255,255,255,0.08)',
  textPrimary: '#ffffff',
  textSecondary: '#cbd5e1', // slate-300
  textMuted: '#94a3b8', // slate-400
  accent: '#22d3ee', // cyan-400
  emerald: '#34d399', // emerald-400
  amber: '#fbbf24', // amber-400
  red: '#f87171', // red-400
  green: '#4ade80', // green-400
  calledOrange: '#fb923c', // orange-400
  progressTrack: 'rgba(255,255,255,0.08)',
  progressFill: '#22d3ee',
  metricBg: 'rgba(255,255,255,0.06)',
  metricBorder: 'rgba(255,255,255,0.10)',
  sectionBg: 'rgba(255,255,255,0.04)',
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_ACCENT: Record<string, string> = {
  waiting: dark.accent,
  called: dark.calledOrange,
  serving: dark.emerald,
  served: dark.green,
  no_show: dark.amber,
  cancelled: dark.red,
};

// ---------------------------------------------------------------------------
// Animated pulse dot (waiting indicator)
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
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [scale, opacity]);

  return (
    <View style={pulseStyles.container}>
      <Animated.View
        style={[
          pulseStyles.ring,
          { borderColor: color, transform: [{ scale }], opacity },
        ]}
      />
      <View style={[pulseStyles.dot, { backgroundColor: color }]} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  container: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ring: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

// ---------------------------------------------------------------------------
// Pulsing border wrapper for "Called" state
// ---------------------------------------------------------------------------

function PulsingBorder({ color, children }: { color: string; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        borderWidth: 2,
        borderColor: color,
        borderRadius: borderRadius.lg,
        overflow: 'hidden' as const,
        opacity,
      }}
    >
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Elapsed Timer (for serving state)
// ---------------------------------------------------------------------------

function ElapsedTimer({ since }: { since: string }) {
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

  return <Text style={styles.elapsedTime}>{elapsed}</Text>;
}

// ---------------------------------------------------------------------------
// Metric Card
// ---------------------------------------------------------------------------

function MetricCard({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string | number;
  label: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={18} color={dark.accent} style={{ marginBottom: spacing.xs }} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Progress Bar
// ---------------------------------------------------------------------------

function ProgressBar({ position }: { position: number | null }) {
  const pos = position ?? 1;
  const progress = Math.max(0.08, Math.min(0.92, (14 - Math.min(pos, 14)) / 14));
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: progress,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  return (
    <View style={styles.progressTrack}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            width: widthAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// QueueCard
// ---------------------------------------------------------------------------

interface Props {
  ticket: TicketResponse;
}

export function QueueCard({ ticket }: Props) {
  const isWaiting = ticket.status === 'waiting';
  const isCalled = ticket.status === 'called';
  const isServing = ticket.status === 'serving';
  const isTerminal = ['served', 'no_show', 'cancelled'].includes(ticket.status);

  const accentColor = STATUS_ACCENT[ticket.status] ?? dark.accent;

  // Completed duration for terminal states
  let completedDurationMin: number | null = null;
  if (ticket.status === 'served' && ticket.completed_at && ticket.created_at) {
    const diff =
      new Date(ticket.completed_at).getTime() - new Date(ticket.created_at).getTime();
    completedDurationMin = Math.round(diff / 60000);
  }

  // Synced timestamp
  const syncedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Service/department label
  const serviceLabel = ticket.service?.name ?? ticket.department?.name ?? null;

  // People ahead
  const peopleAhead =
    ticket.position != null && ticket.position > 0 ? ticket.position - 1 : 0;

  // ---------- Render ----------

  const cardContent = (
    <View style={styles.card}>
      {/* ---- Header: ticket number + position badge ---- */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          {serviceLabel && (
            <Text style={styles.serviceLabel}>{serviceLabel}</Text>
          )}
          <Text style={styles.ticketNumber}>{ticket.ticket_number}</Text>
        </View>
        {isWaiting && ticket.position != null && (
          <View style={styles.positionBadge}>
            <Text style={styles.positionBadgeText}>#{ticket.position}</Text>
          </View>
        )}
      </View>

      {/* ---- WAITING ---- */}
      {isWaiting && (
        <>
          {/* Progress bar */}
          <View style={styles.progressSection}>
            <View style={styles.progressLabelRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <PulseDot color={dark.accent} />
                <Text style={styles.progressLabelText}>In Queue</Text>
              </View>
              <Text style={styles.progressPosition}>
                #{ticket.position ?? '-'} of {(ticket.position ?? 0) + peopleAhead + 1}
              </Text>
            </View>
            <ProgressBar position={ticket.position} />
          </View>

          {/* Metrics row */}
          <View style={styles.metricsRow}>
            <MetricCard
              icon="time-outline"
              value={
                ticket.estimated_wait_minutes != null
                  ? `${ticket.estimated_wait_minutes}m`
                  : '--'
              }
              label="Est. Wait"
            />
            <MetricCard
              icon="list-outline"
              value={ticket.position != null ? `#${ticket.position}` : '--'}
              label="Position"
            />
            <MetricCard
              icon="people-outline"
              value={peopleAhead}
              label="Ahead"
            />
          </View>

          {/* Synced time */}
          <View style={styles.syncRow}>
            <Ionicons name="sync-outline" size={12} color={dark.textMuted} />
            <Text style={styles.syncText}>Synced {syncedAt}</Text>
          </View>
        </>
      )}

      {/* ---- CALLED ---- */}
      {isCalled && ticket.called_at && (
        <PulsingBorder color={dark.calledOrange}>
          <View style={styles.calledSection}>
            <Ionicons name="notifications" size={36} color={dark.calledOrange} />
            <Text style={styles.calledTitle}>It's Your Turn!</Text>
            {ticket.desk && (
              <Text style={styles.deskText}>Go to {ticket.desk.name}</Text>
            )}
            <CountdownTimer calledAt={ticket.called_at} />
          </View>
        </PulsingBorder>
      )}

      {/* ---- SERVING ---- */}
      {isServing && (
        <View style={styles.servingSection}>
          <Ionicons name="checkmark-circle" size={40} color={dark.emerald} />
          <Text style={styles.servingTitle}>Being Served</Text>
          {ticket.desk && (
            <Text style={styles.servingSubtitle}>At {ticket.desk.name}</Text>
          )}
          {ticket.serving_started_at && (
            <ElapsedTimer since={ticket.serving_started_at} />
          )}
        </View>
      )}

      {/* ---- TERMINAL (served / no_show / cancelled) ---- */}
      {isTerminal && (
        <View style={styles.terminalSection}>
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
          <Text style={[styles.terminalTitle, { color: accentColor }]}>
            {ticket.status === 'served'
              ? 'Visit Complete'
              : ticket.status === 'no_show'
                ? 'Missed'
                : 'Cancelled'}
          </Text>
          {completedDurationMin != null && (
            <Text style={styles.terminalDuration}>
              Completed in {completedDurationMin} min
            </Text>
          )}
        </View>
      )}
    </View>
  );

  return cardContent;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    backgroundColor: dark.cardBg,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: dark.cardBorder,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 8,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serviceLabel: {
    fontSize: fontSize.sm,
    color: dark.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  ticketNumber: {
    fontSize: 38,
    fontWeight: '800',
    color: dark.textPrimary,
    letterSpacing: -0.5,
  },
  positionBadge: {
    backgroundColor: 'rgba(34,211,238,0.15)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
  },
  positionBadgeText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: dark.accent,
  },

  // Progress section
  progressSection: {
    gap: spacing.sm,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabelText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: dark.textSecondary,
  },
  progressPosition: {
    fontSize: fontSize.xs,
    color: dark.textMuted,
  },
  progressTrack: {
    height: 6,
    backgroundColor: dark.progressTrack,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: dark.progressFill,
    borderRadius: borderRadius.full,
  },

  // Metrics
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricCard: {
    flex: 1,
    backgroundColor: dark.metricBg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: dark.metricBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: dark.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: fontSize.xs,
    color: dark.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },

  // Sync row
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  syncText: {
    fontSize: fontSize.xs,
    color: dark.textMuted,
  },

  // Called
  calledSection: {
    backgroundColor: 'rgba(251,146,60,0.08)',
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  calledTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: dark.calledOrange,
  },
  deskText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: dark.textPrimary,
  },

  // Serving
  servingSection: {
    backgroundColor: 'rgba(52,211,153,0.08)',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  servingTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: dark.emerald,
  },
  servingSubtitle: {
    fontSize: fontSize.md,
    color: dark.textSecondary,
  },
  elapsedTime: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: dark.emerald,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },

  // Terminal
  terminalSection: {
    backgroundColor: dark.sectionBg,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  terminalTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  terminalDuration: {
    fontSize: fontSize.sm,
    color: dark.textMuted,
  },
});
