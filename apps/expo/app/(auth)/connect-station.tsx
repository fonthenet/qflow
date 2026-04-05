import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Network from 'expo-network';
import { borderRadius, fontSize, spacing } from '@/lib/theme';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import { useOperatorStore } from '@/lib/operator-store';
import * as Station from '@/lib/station-client';

// ── Discovery ───────────────────────────────────────────────────────
//
// Two methods run concurrently, first one wins:
//
//  1. Discovery port (19847) — fixed port, lightweight, ~2s full scan
//  2. Health endpoint (8080+) — probes common API ports as fallback
//
// Both use standard HTTP fetch — zero native deps, works everywhere.

const DISCOVERY_PORT = 19847;
const DISCOVERY_MAGIC = 'QFLO_STATION';
const DEFAULT_API_PORT = 8080;
const SCAN_TIMEOUT = 1200;
const SCAN_BATCH = 30;
const API_PROBE_PORTS = [8080, 8081, 8082, 8083, 8084, 8085];

interface DiscoveryResult {
  ip: string;
  apiPort: number;
  url: string;
  version: string;
  office: string;
}

async function getLocalSubnet(): Promise<string | null> {
  try {
    const ip = await Network.getIpAddressAsync();
    console.log('[discovery] Device IP:', ip);
    if (!ip || ip === '0.0.0.0') return null;
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  } catch (err) {
    console.warn('[discovery] getIpAddressAsync failed:', err);
    return null;
  }
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function probeDiscoveryPort(ip: string): Promise<DiscoveryResult | null> {
  try {
    const res = await fetchWithTimeout(`http://${ip}:${DISCOVERY_PORT}/discover`, SCAN_TIMEOUT);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.magic !== DISCOVERY_MAGIC) return null;
    return {
      ip: data.ip ?? ip,
      apiPort: data.port ?? DEFAULT_API_PORT,
      url: `http://${data.ip ?? ip}:${data.port ?? DEFAULT_API_PORT}`,
      version: data.version ?? '?',
      office: data.office ?? '',
    };
  } catch { return null; }
}

async function probeHealthPort(ip: string, port: number): Promise<DiscoveryResult | null> {
  try {
    const res = await fetchWithTimeout(`http://${ip}:${port}/api/health`, SCAN_TIMEOUT);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.status) return null;
    return { ip, apiPort: port, url: `http://${ip}:${port}`, version: data.version ?? '?', office: '' };
  } catch { return null; }
}

async function probeHost(ip: string): Promise<DiscoveryResult | null> {
  const results = await Promise.all([
    probeDiscoveryPort(ip),
    ...API_PROBE_PORTS.map((p) => probeHealthPort(ip, p)),
  ]);
  return results.find((r) => r !== null) ?? null;
}

async function scanSubnet(
  subnet: string,
  onProgress: (scanned: number, total: number) => void,
  abortRef: { current: boolean },
): Promise<DiscoveryResult | null> {
  for (let start = 1; start <= 254; start += SCAN_BATCH) {
    if (abortRef.current) return null;
    const batch: Promise<DiscoveryResult | null>[] = [];
    for (let i = start; i < start + SCAN_BATCH && i <= 254; i++) {
      batch.push(probeHost(`${subnet}.${i}`));
    }
    const results = await Promise.all(batch);
    onProgress(Math.min(start + SCAN_BATCH - 1, 254), 254);
    const found = results.find((r) => r !== null);
    if (found) return found;
  }
  return null;
}

// ── Spinner ─────────────────────────────────────────────────────────

function ScanSpinner() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="scan-outline" size={22} color="#3b82f6" />
    </Animated.View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────

export default function ConnectStationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const connect = useLocalConnectionStore((s) => s.connect);
  const setSession = useOperatorStore((s) => s.setSession);

  const [ip, setIp] = useState('');
  const [port, setPort] = useState(String(DEFAULT_API_PORT));
  const [loading, setLoading] = useState(false);
  const [stationInfo, setStationInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ scanned: 0, total: 254 });
  const abortScanRef = useRef(false);

  // Desk picker state
  const [desks, setDesks] = useState<any[]>([]);
  const [selectedDesk, setSelectedDesk] = useState<any>(null);
  const [loadingDesks, setLoadingDesks] = useState(false);

  const buildUrl = () => {
    const host = ip.trim();
    if (!host) return null;
    const p = port.trim() || String(DEFAULT_API_PORT);
    if (host.startsWith('http://') || host.startsWith('https://')) return host;
    return `http://${host}:${p}`;
  };

  const loadStationInfo = async (url: string) => {
    setLoading(true);
    setError(null);
    setDesks([]);
    setSelectedDesk(null);
    try {
      const health = await Station.stationHealth(url);
      const session = await Station.stationGetSession(url);
      if (!session?.staff_id) { setError(t('connectStation.noSession')); setLoading(false); return; }
      const branding = await Station.stationBranding(url).catch(() => null);

      const info = {
        url,
        version: health.version,
        cloud: health.cloud,
        session,
        officeName: session.office_name ?? branding?.officeName ?? 'Office',
        staffName: session.staff_name ?? session.full_name ?? 'Staff',
        deskName: session.desk_name ?? null,
      };
      setStationInfo(info);

      // Fetch available desks
      setLoadingDesks(true);
      try {
        const officeIds = session.office_ids ?? [session.office_id];
        const allDesks = await Station.stationQuery(url, 'desks', officeIds);
        setDesks(allDesks);
        // Pre-select station's current desk
        const stationDesk = allDesks.find((d: any) => d.id === session.desk_id);
        setSelectedDesk(stationDesk ?? allDesks[0] ?? null);
      } catch { /* desk fetch is optional */ }
      setLoadingDesks(false);
    } catch (err: any) {
      setError(err?.message ?? t('connectStation.unreachable'));
    } finally {
      setLoading(false);
    }
  };

  const handleAutoScan = async () => {
    setScanning(true);
    setError(null);
    setStationInfo(null);
    setScanProgress({ scanned: 0, total: 254 });
    abortScanRef.current = false;

    try {
      const subnet = await getLocalSubnet();
      console.log('[discovery] Subnet:', subnet);
      if (!subnet) { setError(t('connectStation.noWifi')); setScanning(false); return; }

      console.log(`[discovery] Scanning ${subnet}.1-254 on ports ${DISCOVERY_PORT}, ${API_PROBE_PORTS.join(',')}`);
      const result = await scanSubnet(
        subnet,
        (scanned, total) => setScanProgress({ scanned, total }),
        abortScanRef,
      );

      if (abortScanRef.current) { setScanning(false); return; }

      if (result) {
        setIp(result.ip);
        setPort(String(result.apiPort));
        await loadStationInfo(result.url);
      } else {
        setError(t('connectStation.noStationFound'));
      }
    } catch (err: any) {
      if (!abortScanRef.current) setError(err?.message ?? t('connectStation.scanFailed'));
    } finally {
      setScanning(false);
    }
  };

  const handleManualFind = async () => {
    const url = buildUrl();
    if (!url) { Alert.alert(t('connectStation.error'), t('connectStation.enterIp')); return; }
    setStationInfo(null);
    await loadStationInfo(url);
  };

  const handleConnect = async () => {
    const url = stationInfo?.url ?? buildUrl();
    if (!url || !stationInfo?.session) return;
    setLoading(true);
    try {
      const success = await connect(url);
      if (!success) { setError(t('connectStation.connectionFailed')); setLoading(false); return; }
      const s = stationInfo.session;
      const desk = selectedDesk;
      setSession({
        staffId: s.staff_id,
        deskId: desk?.id ?? s.desk_id ?? null,
        deskName: desk?.display_name ?? desk?.name ?? s.desk_name ?? null,
        officeId: s.office_id,
        officeName: s.office_name ?? 'Office',
        departmentId: desk?.department_id ?? s.department_id ?? null,
        departmentName: desk?.departments?.name ?? s.department_name ?? null,
      });
      router.replace('/(operator)/desk');
    } catch (err: any) {
      setError(err?.message ?? t('connectStation.connectionFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleAutoScan();
    return () => { abortScanRef.current = true; };
  }, []);

  const scanPercent = scanProgress.total > 0
    ? Math.round((scanProgress.scanned / scanProgress.total) * 100)
    : 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={['#1e3a5f', '#0f172a']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="wifi" size={32} color="#3b82f6" />
            </View>
            <Text style={styles.title}>{t('connectStation.title')}</Text>
            <Text style={styles.subtitle}>{t('connectStation.subtitle')}</Text>
          </View>

          {/* Auto-scan */}
          <View style={styles.card}>
            {scanning ? (
              <View style={styles.scanningContainer}>
                <ScanSpinner />
                <View style={{ flex: 1 }}>
                  <Text style={styles.scanningText}>{t('connectStation.scanning')}</Text>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${scanPercent}%` }]} />
                  </View>
                  <Text style={styles.scanProgressText}>{scanPercent}%</Text>
                </View>
                <TouchableOpacity onPress={() => { abortScanRef.current = true; }} hitSlop={12}>
                  <Ionicons name="close-circle" size={24} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.autoScanBtn} onPress={handleAutoScan} disabled={loading} activeOpacity={0.7}>
                <Ionicons name="scan-outline" size={20} color="#fff" />
                <Text style={styles.autoScanBtnText}>{t('connectStation.autoSearch')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Manual */}
          <View style={styles.card}>
            <Text style={styles.manualLabel}>{t('connectStation.manualConnect')}</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="192.168.1.100"
                placeholderTextColor="#94a3b8"
                value={ip}
                onChangeText={setIp}
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={[styles.input, { width: 72, textAlign: 'center' }]}
                placeholder={String(DEFAULT_API_PORT)}
                placeholderTextColor="#94a3b8"
                value={port}
                onChangeText={setPort}
                keyboardType="number-pad"
              />
            </View>
            <TouchableOpacity style={styles.scanBtn} onPress={handleManualFind} disabled={loading || scanning || !ip.trim()} activeOpacity={0.7}>
              {loading && !stationInfo ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="search-outline" size={18} color="#fff" />
                  <Text style={styles.scanBtnText}>{t('connectStation.findStation')}</Text>
                </>
              )}
            </TouchableOpacity>
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#ef4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </View>

          {/* Station Found */}
          {stationInfo && (
            <View style={styles.card}>
              <View style={styles.stationHeader}>
                <View style={styles.stationDot} />
                <Text style={styles.stationTitle}>{t('connectStation.stationFound')}</Text>
              </View>
              <InfoRow icon="business-outline" label={t('connectStation.office')} value={stationInfo.officeName} />
              <InfoRow icon="person-outline" label={t('connectStation.operator')} value={stationInfo.staffName} />
              <InfoRow icon="git-branch-outline" label={t('connectStation.version')} value={`v${stationInfo.version}`} />
              <InfoRow
                icon="cloud-outline"
                label={t('connectStation.cloud')}
                value={stationInfo.cloud ? t('connectStation.syncing') : t('connectStation.offlineOnly')}
                valueColor={stationInfo.cloud ? '#22c55e' : '#f59e0b'}
              />

              {/* Desk Picker */}
              {loadingDesks ? (
                <ActivityIndicator color="#3b82f6" style={{ marginVertical: 8 }} />
              ) : desks.length > 0 ? (
                <View style={styles.deskSection}>
                  <Text style={styles.deskSectionLabel}>{t('connectStation.selectDesk')}</Text>
                  {desks.map((desk: any) => {
                    const isSelected = selectedDesk?.id === desk.id;
                    const deskLabel = desk.display_name ?? desk.name;
                    const deptName = desk.departments?.name;
                    return (
                      <TouchableOpacity
                        key={desk.id}
                        style={[styles.deskOption, isSelected && styles.deskOptionSelected]}
                        onPress={() => setSelectedDesk(desk)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.deskRadio, isSelected && styles.deskRadioSelected]}>
                          {isSelected && <View style={styles.deskRadioInner} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.deskOptionName, isSelected && styles.deskOptionNameSelected]}>{deskLabel}</Text>
                          {deptName && <Text style={styles.deskOptionSub}>{deptName}</Text>}
                        </View>
                        {desk.id === stationInfo.session.desk_id && (
                          <View style={styles.stationDeskBadge}>
                            <Text style={styles.stationDeskBadgeText}>{t('connectStation.stationDesk')}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              <TouchableOpacity style={styles.connectBtn} onPress={handleConnect} disabled={loading} activeOpacity={0.7}>
                {loading ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name="link-outline" size={18} color="#fff" />
                    <Text style={styles.connectBtnText}>
                      {selectedDesk
                        ? `${t('connectStation.connect')} → ${selectedDesk.display_name ?? selectedDesk.name}`
                        : t('connectStation.connect')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="arrow-back-outline" size={16} color="#94a3b8" />
            <Text style={styles.backBtnText}>{t('connectStation.backToCloud')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

function InfoRow({ icon, label, value, valueColor }: { icon: string; label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={16} color="#64748b" />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  title: { fontSize: fontSize.xxl ?? 28, fontWeight: '800', color: '#f8fafc', textAlign: 'center' },
  subtitle: { fontSize: fontSize.md, color: '#94a3b8', textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: borderRadius.lg,
    padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  autoScanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: '#1d4ed8', paddingVertical: 16, borderRadius: borderRadius.md,
  },
  autoScanBtnText: { color: '#fff', fontSize: fontSize.lg, fontWeight: '700' },
  scanningContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  scanningText: { fontSize: fontSize.sm, fontWeight: '600', color: '#93c5fd', marginBottom: 6 },
  progressBar: { height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#3b82f6', borderRadius: 3 },
  scanProgressText: { fontSize: fontSize.xs, color: '#64748b', marginTop: 4 },
  manualLabel: { fontSize: fontSize.sm, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: fontSize.md, color: '#f8fafc',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: '#3b82f6', paddingVertical: 14, borderRadius: borderRadius.md,
  },
  scanBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(239, 68, 68, 0.15)', padding: spacing.md, borderRadius: borderRadius.md,
  },
  errorText: { color: '#fca5a5', fontSize: fontSize.sm, flex: 1 },
  stationHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stationDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e' },
  stationTitle: { fontSize: fontSize.lg, fontWeight: '700', color: '#f8fafc' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  infoLabel: { fontSize: fontSize.sm, color: '#94a3b8', width: 70 },
  infoValue: { fontSize: fontSize.sm, fontWeight: '600', color: '#f8fafc', flex: 1 },
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: '#22c55e', paddingVertical: 16, borderRadius: borderRadius.md, marginTop: spacing.sm,
  },
  connectBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '800' },
  backBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  backBtnText: { color: '#94a3b8', fontSize: fontSize.sm, fontWeight: '600' },

  // Desk picker
  deskSection: { gap: spacing.sm },
  deskSectionLabel: { fontSize: fontSize.sm, fontWeight: '600', color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.5 },
  deskOption: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: borderRadius.md,
    padding: spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  deskOptionSelected: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: '#3b82f6',
  },
  deskRadio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  deskRadioSelected: { borderColor: '#3b82f6' },
  deskRadioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#3b82f6' },
  deskOptionName: { fontSize: fontSize.md, fontWeight: '600', color: '#cbd5e1' },
  deskOptionNameSelected: { color: '#f8fafc' },
  deskOptionSub: { fontSize: fontSize.xs, color: '#64748b', marginTop: 1 },
  stationDeskBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.full,
  },
  stationDeskBadgeText: { fontSize: 9, fontWeight: '700', color: '#93c5fd', textTransform: 'uppercase' },
});
