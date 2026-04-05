import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import { spacing, fontSize, borderRadius } from '@/lib/theme';

export function ConnectionBanner() {
  const { t } = useTranslation();
  const mode = useLocalConnectionStore((s) => s.mode);
  const status = useLocalConnectionStore((s) => s.connectionStatus);
  const stationUrl = useLocalConnectionStore((s) => s.stationUrl);
  const disconnect = useLocalConnectionStore((s) => s.disconnect);
  const connect = useLocalConnectionStore((s) => s.connect);

  if (mode !== 'local') return null;

  const isError = status === 'error';
  const isConnecting = status === 'connecting';

  const handleRetry = () => {
    if (stationUrl) connect(stationUrl);
  };

  return (
    <View style={[styles.banner, isError && styles.bannerError, isConnecting && styles.bannerWarning]}>
      <Ionicons
        name={isError ? 'warning-outline' : isConnecting ? 'sync-outline' : 'wifi'}
        size={14}
        color={isError ? '#fca5a5' : isConnecting ? '#fde68a' : '#86efac'}
      />
      <Text style={[styles.text, isError && styles.textError, isConnecting && styles.textWarning]}>
        {isError
          ? t('connectStation.disconnected')
          : isConnecting
            ? t('connectStation.reconnecting')
            : t('connectStation.localMode')}
      </Text>
      {isError && (
        <TouchableOpacity onPress={handleRetry} style={styles.retryBtn}>
          <Text style={styles.retryText}>{t('common.retry') ?? 'Retry'}</Text>
        </TouchableOpacity>
      )}
      {!isError && !isConnecting && (
        <TouchableOpacity onPress={disconnect} style={styles.disconnectBtn}>
          <Ionicons name="close-circle-outline" size={14} color="#86efac" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(34, 197, 94, 0.2)',
  },
  bannerError: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderBottomColor: 'rgba(239, 68, 68, 0.2)',
  },
  bannerWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderBottomColor: 'rgba(245, 158, 11, 0.2)',
  },
  text: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: '#22c55e',
  },
  textError: {
    color: '#ef4444',
  },
  textWarning: {
    color: '#f59e0b',
  },
  retryBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
  },
  retryText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: '#fff',
  },
  disconnectBtn: {
    padding: 2,
  },
});
