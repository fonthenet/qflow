/**
 * QR Scan screen — camera-based code scanner for joining an organisation.
 *
 * Permission flow:
 *   1. useCameraPermissions() returns the current permission state.
 *   2. If undetermined: show rationale UI, then requestPermission().
 *   3. If denied: show Settings deep-link (Linking.openSettings).
 *   4. If granted: show CameraView with QR barcode scanner.
 *
 * On successful scan, the parsed join code is forwarded to the
 * /(customer)/queue/[ticketId] screen (or the join flow edge function).
 *
 * TODO(mobile-sprint-2): Implement the full join flow:
 *   - POST to edge function /api/join with the code
 *   - Receive ticketId in response
 *   - Navigate to /(customer)/queue/<ticketId>
 *   See apps/web/app/api/join/route.ts for the server-side contract.
 *
 * TODO(mobile-sprint-2): Wire the `code` query param so deep links that
 *   arrive via WhatsApp/Messenger pre-fill the manual entry field.
 *
 * This file is intentionally a stub — the full implementation lives in
 * apps/expo/app/scan.tsx which is the battle-tested production version.
 * Merge or extend from there when building this out.
 */

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, fontSize, borderRadius } from '@/lib/theme';

export default function ScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { code: prefilledCode } = useLocalSearchParams<{ code?: string }>();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  // --- Permission not yet determined ---
  if (!permission) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t('scan.requestingCamera')}
        </Text>
      </View>
    );
  }

  // --- Permission denied ---
  if (!permission.granted) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <Text
          style={[styles.heading, { color: colors.text }]}
          accessibilityRole="header"
        >
          {t('scan.cameraNeeded')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t('scan.cameraNeededMsg')}
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={requestPermission}
          accessibilityRole="button"
          accessibilityLabel={t('scan.allowCamera')}
          // 44pt minimum tap target
        >
          <Text style={styles.buttonText}>{t('scan.allowCamera')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open device settings"
        >
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Open Settings
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Permission granted ---
  function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);

    // TODO(mobile-sprint-2): parse data, call join edge function, navigate
    // For now just navigate to the queue stub with the raw data as ticketId
    const joinMatch = data.match(/\/join\/([a-zA-Z0-9_-]+)/);
    const ticketMatch = data.match(/\/(?:q|ticket)\/([a-zA-Z0-9_-]+)/);

    if (joinMatch) {
      // TODO: POST join code to server, receive ticketId
      router.replace({
        pathname: '/(customer)/queue/[ticketId]',
        params: { ticketId: joinMatch[1] },
      });
    } else if (ticketMatch) {
      router.replace({
        pathname: '/(customer)/queue/[ticketId]',
        params: { ticketId: ticketMatch[1] },
      });
    } else {
      // Unrecognised — let user try again
      setTimeout(() => setScanned(false), 2000);
    }
  }

  return (
    <View style={styles.fullscreen}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Back button */}
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + spacing.md }]}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        // 44x44 minimum
      >
        <Text style={styles.backButtonText}>{t('common.back')}</Text>
      </TouchableOpacity>

      {/* Instruction label */}
      <View
        style={[
          styles.instructionBadge,
          { bottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text style={styles.instructionText}>{t('scan.scanTip')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  heading: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    height: 52,
    minWidth: 200,
    minHeight: 44,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  buttonText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: '#fff',
  },
  linkButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  linkText: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  instructionBadge: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  instructionText: {
    color: '#fff',
    fontSize: fontSize.sm,
  },
});
