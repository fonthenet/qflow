import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme';

interface Props {
  calledAt: string;
  durationSeconds?: number; // default 60
}

const GREEN = '#22c55e';
const YELLOW = '#f59e0b';
const RED = '#ef4444';

function getPhaseColor(remaining: number): string {
  if (remaining > 30) return GREEN;
  if (remaining > 10) return YELLOW;
  return RED;
}

export function CountdownTimer({ calledAt, durationSeconds = 60 }: Props) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [remaining, setRemaining] = useState(durationSeconds);
  const animatedProgress = useRef(new Animated.Value(1)).current;

  // Single smooth animation for the bar — runs once from current position to 0
  useEffect(() => {
    const calledTime = new Date(calledAt).getTime();
    const elapsed = (Date.now() - calledTime) / 1000;
    const startProgress = Math.max(0, Math.min(1, (durationSeconds - elapsed) / durationSeconds));
    const remainingDuration = Math.max(0, durationSeconds - elapsed) * 1000;

    animatedProgress.setValue(startProgress);

    if (remainingDuration > 0) {
      Animated.timing(animatedProgress, {
        toValue: 0,
        duration: remainingDuration,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    }

    return () => {
      animatedProgress.stopAnimation();
    };
  }, [calledAt, durationSeconds, animatedProgress]);

  // Separate interval just for the number display (seconds)
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

  const phaseColor = getPhaseColor(remaining);
  const isExpired = remaining === 0;
  const mutedColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const animatedWidth = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      <Text style={[styles.countdown, { color: phaseColor }]}>
        {isExpired ? '0' : String(remaining)}
      </Text>
      <Text style={[styles.label, { color: mutedColor }, isExpired && styles.labelExpired]}>
        {isExpired ? t('customer.expired') : t('time.seconds')}
      </Text>

      <View style={[styles.barTrack, { backgroundColor: trackColor }]}>
        <Animated.View
          style={[
            styles.barFill,
            {
              width: animatedWidth,
              backgroundColor: phaseColor,
            },
          ]}
        />
      </View>

      <Text style={[styles.hint, { color: mutedColor }, isExpired && { color: RED }]}>
        {isExpired
          ? t('customer.timesUp')
          : t('customer.proceedToCounter')}
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
    marginTop: 2,
  },
});
