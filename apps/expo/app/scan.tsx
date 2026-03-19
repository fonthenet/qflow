import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Keyboard,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '@/lib/store';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

import { API_BASE_URL as BASE_URL } from '@/lib/config';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FRAME_SIZE = 260;
const CORNER_LENGTH = 36;
const CORNER_THICKNESS = 4;
const CORNER_RADIUS = 12;

type ScanState = 'scanning' | 'success' | 'error';

type ParsedCode =
  | { type: 'ticket'; token: string }
  | { type: 'join'; token: string }
  | { type: 'kiosk'; slug: string }
  | { type: 'book'; slug: string }
  | null;

function parseScannedData(data: string): ParsedCode {
  const trimmed = data.trim();

  const qMatch = trimmed.match(/\/q\/([a-zA-Z0-9_-]+)/);
  if (qMatch) return { type: 'ticket', token: qMatch[1] };

  const joinMatch = trimmed.match(/\/join\/([a-zA-Z0-9_-]+)/);
  if (joinMatch) return { type: 'join', token: joinMatch[1] };

  const kioskMatch = trimmed.match(/\/kiosk\/([a-zA-Z0-9_-]+)/);
  if (kioskMatch) return { type: 'kiosk', slug: kioskMatch[1] };

  const bookMatch = trimmed.match(/\/book\/([a-zA-Z0-9_-]+)/);
  if (bookMatch) return { type: 'book', slug: bookMatch[1] };

  if (/^[a-zA-Z0-9_-]{8,}$/.test(trimmed)) return { type: 'ticket', token: trimmed };

  return null;
}

export default function ScanScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { setActiveToken } = useAppStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const manualEntryAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [scanLineAnim]);

  useEffect(() => {
    setScanState('scanning');
    setShowManualEntry(false);
    setManualCode('');
  }, []);

  const flashOverlay = (color: 'success' | 'error', duration: number) => {
    overlayOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(overlayOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration, useNativeDriver: true }),
    ]).start();
  };

  const handleTicketSuccess = (token: string) => {
    setScanState('success');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    flashOverlay('success', 300);
    setTimeout(() => {
      setActiveToken(token);
      router.replace('/(tabs)');
    }, 350);
  };

  const handleJoinLink = (joinToken: string) => {
    setScanState('success');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    flashOverlay('success', 300);
    setTimeout(() => {
      router.replace(`/join/${joinToken}` as any);
    }, 350);
  };

  const handleKiosk = (slug: string) => {
    setScanState('success');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    flashOverlay('success', 300);
    setTimeout(() => {
      router.replace(`/kiosk/${slug}` as any);
    }, 350);
  };

  const handleWebLink = (slug: string, path: string) => {
    setScanState('success');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    flashOverlay('success', 300);
    setTimeout(() => {
      Linking.openURL(`${BASE_URL}${path}`);
      setScanState('scanning');
    }, 350);
  };

  const handleError = () => {
    setScanState('error');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    flashOverlay('error', 600);
    setTimeout(() => setScanState('scanning'), 2000);
  };

  const handleParsed = (parsed: ParsedCode) => {
    if (!parsed) { handleError(); return; }
    switch (parsed.type) {
      case 'ticket': handleTicketSuccess(parsed.token); break;
      case 'join': handleJoinLink(parsed.token); break;
      case 'kiosk': handleKiosk(parsed.slug); break;
      case 'book': handleWebLink(parsed.slug, `/book/${parsed.slug}`); break;
    }
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanState !== 'scanning') return;
    handleParsed(parseScannedData(data));
  };

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) return;
    Keyboard.dismiss();
    handleParsed(parseScannedData(code));
    setManualCode('');
  };

  const toggleManualEntry = () => {
    const next = !showManualEntry;
    setShowManualEntry(next);
    Animated.timing(manualEntryAnim, { toValue: next ? 1 : 0, duration: 300, useNativeDriver: true }).start();
  };

  if (!permission) {
    return (
      <View style={[styles.permissionContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.permissionLoadingText, { color: colors.textSecondary }]}>Requesting camera access...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.permissionContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.permissionIconCircle, { backgroundColor: colors.infoLight }]}>
          <Ionicons name="camera-outline" size={56} color={colors.primaryLight} />
        </View>
        <Text style={[styles.permissionTitle, { color: colors.text }]}>Camera Access Needed</Text>
        <Text style={[styles.permissionSubtitle, { color: colors.textSecondary }]}>
          We need your camera to scan QR codes at queue locations.
        </Text>
        <TouchableOpacity style={[styles.permissionButton, { backgroundColor: colors.primary }]} onPress={requestPermission}>
          <Ionicons name="camera" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.permissionButtonText}>Allow Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={[styles.backLinkText, { color: colors.primaryLight }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const frameTop = (SCREEN_HEIGHT - FRAME_SIZE) / 2 - 40;
  const frameLeft = (SCREEN_WIDTH - FRAME_SIZE) / 2;
  const scanLineTranslateY = scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME_SIZE - 4] });
  const manualEntryTranslateY = manualEntryAnim.interpolate({ inputRange: [0, 1], outputRange: [300, 0] });
  const overlayColor = scanState === 'success' ? 'rgba(34,197,94,0.35)' : scanState === 'error' ? 'rgba(239,68,68,0.35)' : 'transparent';

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanState === 'scanning' ? handleBarCodeScanned : undefined}
      />

      {/* Dark overlay regions */}
      <View style={[styles.overlayRegion, { top: 0, left: 0, right: 0, height: frameTop }]} />
      <View style={[styles.overlayRegion, { top: frameTop + FRAME_SIZE, left: 0, right: 0, bottom: 0 }]} />
      <View style={[styles.overlayRegion, { top: frameTop, left: 0, width: frameLeft, height: FRAME_SIZE }]} />
      <View style={[styles.overlayRegion, { top: frameTop, right: 0, width: frameLeft, height: FRAME_SIZE }]} />

      {/* Scan frame */}
      <View style={[styles.scanFrame, { top: frameTop, left: frameLeft }]}>
        <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineTranslateY }] }]} />
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
      </View>

      {/* Flash overlay */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: overlayColor, opacity: overlayOpacity }]}>
        {scanState === 'success' && (
          <View style={styles.feedbackCenter}>
            <View style={[styles.feedbackIcon, { backgroundColor: colors.success }]}>
              <Ionicons name="checkmark" size={48} color="#fff" />
            </View>
          </View>
        )}
        {scanState === 'error' && (
          <View style={styles.feedbackCenter}>
            <View style={[styles.feedbackIcon, { backgroundColor: colors.error }]}>
              <Ionicons name="close" size={48} color="#fff" />
            </View>
            <Text style={styles.feedbackText}>Invalid QR code</Text>
          </View>
        )}
      </Animated.View>

      {/* Back button + title */}
      <View style={styles.topSection}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.scanTitle}>Scan QR Code</Text>
        <Text style={styles.scanSubtitle}>Point at the queue display or ticket</Text>
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomSection}>
        <TouchableOpacity style={styles.torchButton} onPress={() => setTorch((p) => !p)} activeOpacity={0.7}>
          <Ionicons name={torch ? 'flash' : 'flash-outline'} size={26} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={toggleManualEntry} activeOpacity={0.7}>
          <Text style={styles.manualEntryBottomLink}>Enter code manually</Text>
        </TouchableOpacity>
        <Text style={styles.tipText}>Having trouble? Make sure the QR code is well-lit</Text>
      </View>

      {/* Manual entry sheet */}
      {showManualEntry && (
        <Animated.View style={[styles.manualSheet, { backgroundColor: colors.surface, transform: [{ translateY: manualEntryTranslateY }] }]}>
          <View style={[styles.manualSheetHandle, { backgroundColor: colors.border }]} />
          <Text style={[styles.manualSheetTitle, { color: colors.text }]}>Enter Queue Code</Text>
          <View style={styles.manualInputRow}>
            <TextInput
              style={[styles.manualInput, { backgroundColor: colors.surfaceSecondary, color: colors.text, borderColor: colors.border }]}
              placeholder="Enter queue code or paste link"
              placeholderTextColor={colors.textMuted}
              value={manualCode}
              onChangeText={setManualCode}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handleManualSubmit}
            />
            <TouchableOpacity
              style={[styles.joinButton, { backgroundColor: colors.primary }, !manualCode.trim() && styles.joinButtonDisabled]}
              onPress={handleManualSubmit}
              disabled={!manualCode.trim()}
              activeOpacity={0.7}
            >
              <Text style={styles.joinButtonText}>Join</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={toggleManualEntry} activeOpacity={0.7}>
            <Text style={[styles.manualSheetCancel, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  permissionLoadingText: { fontSize: fontSize.md },
  permissionIconCircle: { width: 112, height: 112, borderRadius: 56, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.lg },
  permissionTitle: { fontSize: fontSize.xxl, fontWeight: '700', marginBottom: spacing.sm, textAlign: 'center' },
  permissionSubtitle: { fontSize: fontSize.md, textAlign: 'center', lineHeight: 22, marginBottom: spacing.lg, paddingHorizontal: spacing.md },
  permissionButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: 14, borderRadius: borderRadius.lg },
  permissionButtonText: { fontSize: fontSize.lg, fontWeight: '600', color: '#fff' },
  backLink: { marginTop: spacing.lg, paddingVertical: spacing.sm },
  backLinkText: { fontSize: fontSize.md, fontWeight: '500' },

  overlayRegion: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },

  scanFrame: { position: 'absolute', width: FRAME_SIZE, height: FRAME_SIZE },
  scanLine: { position: 'absolute', left: 8, right: 8, height: 2, backgroundColor: '#3b82f6', borderRadius: 1, shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6, elevation: 4 },
  corner: { position: 'absolute', width: CORNER_LENGTH, height: CORNER_LENGTH },
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS, borderColor: '#fff', borderTopLeftRadius: CORNER_RADIUS },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS, borderColor: '#fff', borderTopRightRadius: CORNER_RADIUS },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS, borderColor: '#fff', borderBottomLeftRadius: CORNER_RADIUS },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS, borderColor: '#fff', borderBottomRightRadius: CORNER_RADIUS },

  feedbackCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  feedbackIcon: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center' },
  feedbackText: { fontSize: fontSize.lg, fontWeight: '600', color: '#fff', marginTop: spacing.md },

  topSection: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: Platform.OS === 'ios' ? 60 : 46, paddingHorizontal: spacing.lg, alignItems: 'center' },
  backButton: { position: 'absolute', left: spacing.lg, top: Platform.OS === 'ios' ? 60 : 46, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  scanTitle: { fontSize: fontSize.xxl, fontWeight: '700', color: '#fff', marginBottom: spacing.xs },
  scanSubtitle: { fontSize: fontSize.md, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },

  bottomSection: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: Platform.OS === 'ios' ? 50 : 36, alignItems: 'center', gap: spacing.md },
  torchButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xs },
  manualEntryBottomLink: { fontSize: fontSize.md, color: '#fff', fontWeight: '500', textDecorationLine: 'underline' },
  tipText: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.5)', textAlign: 'center', paddingHorizontal: spacing.xl },

  manualSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: Platform.OS === 'ios' ? 44 : 28, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 16 },
  manualSheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  manualSheetTitle: { fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
  manualInputRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  manualInput: { flex: 1, height: 48, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, fontSize: fontSize.md, borderWidth: 1 },
  joinButton: { height: 48, paddingHorizontal: spacing.lg, borderRadius: borderRadius.md, justifyContent: 'center', alignItems: 'center' },
  joinButtonDisabled: { opacity: 0.5 },
  joinButtonText: { fontSize: fontSize.md, fontWeight: '600', color: '#fff' },
  manualSheetCancel: { fontSize: fontSize.md, textAlign: 'center', paddingVertical: spacing.sm },
});
