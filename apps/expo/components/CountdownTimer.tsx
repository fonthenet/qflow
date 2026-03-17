import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  calledAt: string;
  durationSeconds?: number; // default 60
}

const GREEN = '#22c55e';
const YELLOW = '#f59e0b';
const RED = '#ef4444';
const BAR_TRACK = 'rgba(255,255,255,0.08)';

function getPhaseColor(remaining: number): string {
  if (remaining > 30) return GREEN;
  if (remaining > 10) return YELLOW;
  return RED;
}

export function CountdownTimer({ calledAt, durationSeconds = 60 }: Props) {
  const [remaining, setRemaining] = useState(durationSeconds);

  useEffect(() => {
    const calledTime = new Date(calledAt).getTime();
    const update = () => {
      const elapsed = Math.floor((Date.now() - calledTime) / 1000);
      setRemaining(Math.max(0, durationSeconds - elapsed));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [calledAt, durationSeconds]);

  const progress = remaining / durationSeconds;
  const phaseColor = getPhaseColor(remaining);
  const isExpired = remaining === 0;

  return (
    <View style={styles.container}>
      <Text style={[styles.countdown, { color: phaseColor }]}>
        {isExpired ? '0' : String(remaining)}
      </Text>
      <Text style={[styles.label, isExpired && styles.labelExpired]}>
        {isExpired ? "TIME'S UP" : 'seconds remaining'}
      </Text>

      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            {
              width: `${progress * 100}%`,
              backgroundColor: phaseColor,
            },
          ]}
        />
      </View>

      <Text style={[styles.hint, isExpired && styles.hintExpired]}>
        {isExpired
          ? 'Time expired \u2013 please check with staff'
          : 'Please proceed to the counter'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  countdown: {
    fontSize: 42,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 48,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelExpired: {
    color: RED,
    fontWeight: '700',
  },
  barTrack: {
    width: '100%',
    height: 6,
    backgroundColor: BAR_TRACK,
    borderRadius: 9999,
    overflow: 'hidden',
    marginTop: 4,
  },
  barFill: {
    height: '100%',
    borderRadius: 9999,
  },
  hint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  hintExpired: {
    color: 'rgba(255,255,255,0.5)',
  },
});
