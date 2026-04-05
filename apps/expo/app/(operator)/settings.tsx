import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useOperatorStore } from '@/lib/operator-store';
import { useAuth } from '@/lib/auth-context';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import * as Actions from '@/lib/data-adapter';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeskOption {
  id: string;
  name: string;
  display_name: string | null;
  department_id: string | null;
  departments: { id: string; name: string } | null;
  current_staff_id: string | null;
  status: string | null;
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function OperatorSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, setSession, clearSession } = useOperatorStore();
  const { staffRole } = useAuth();
  const localMode = useLocalConnectionStore((s) => s.mode);
  const connectionStatus = useLocalConnectionStore((s) => s.connectionStatus);
  const stationUrl = useLocalConnectionStore((s) => s.stationUrl);
  const disconnectStation = useLocalConnectionStore((s) => s.disconnect);

  const [deskPickerVisible, setDeskPickerVisible] = useState(false);
  const [availableDesks, setAvailableDesks] = useState<DeskOption[]>([]);
  const [loadingDesks, setLoadingDesks] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  const isAdmin = staffRole === 'admin' || staffRole === 'manager' || staffRole === 'branch_admin';
  const isLocal = localMode === 'local';

  // Station info (local mode only)
  const [syncStatus, setSyncStatus] = useState<{ isOnline: boolean; pendingCount: number; lastSyncAt: string | null } | null>(null);
  const [devices, setDevices] = useState<Array<{ id: string; type: string; name: string; lastPing: string; connected: boolean }>>([]);
  const [kioskInfo, setKioskInfo] = useState<{ kioskUrl: string; displayUrl: string; localIP: string } | null>(null);
  const [publicLinks, setPublicLinks] = useState<{ kioskUrl: string; displayUrl: string } | null>(null);

  // Fetch all station info on mount + poll devices every 10s
  useEffect(() => {
    if (!isLocal || !stationUrl) return;
    const SC = require('@/lib/station-client');

    const fetchAll = () => {
      SC.stationSyncStatus(stationUrl).then(setSyncStatus).catch(() => {});
      SC.stationDeviceStatus(stationUrl).then((r: any) => setDevices(r.devices ?? [])).catch(() => {});
      SC.stationKioskInfo(stationUrl).then(setKioskInfo).catch(() => {});
      SC.stationPublicLinks(stationUrl).then(setPublicLinks).catch(() => {});
    };
    fetchAll();
    const iv = setInterval(() => {
      SC.stationDeviceStatus(stationUrl).then((r: any) => setDevices(r.devices ?? [])).catch(() => {});
      SC.stationSyncStatus(stationUrl).then(setSyncStatus).catch(() => {});
    }, 10_000);
    return () => clearInterval(iv);
  }, [isLocal, stationUrl]);

  // ── Load desks when picker opens ────────────────────────────────
  const openDeskPicker = useCallback(async () => {
    if (!session?.officeId) return;
    setDeskPickerVisible(true);
    setLoadingDesks(true);
    try {
      const desks = await Actions.fetchAvailableDesks(session.officeId);
      setAvailableDesks(desks as unknown as DeskOption[]);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setLoadingDesks(false);
    }
  }, [session?.officeId]);

  // ── Switch desk ────────────────────────────────────────────────
  const handleSwitchToDesk = async (desk: DeskOption) => {
    if (!session?.staffId) return;
    // Check if desk is taken by someone else
    if (desk.current_staff_id && desk.current_staff_id !== session.staffId) {
      Alert.alert(t('desk.occupied'), t('desk.occupied'));
      return;
    }
    setSwitching(true);
    try {
      const result = await Actions.switchDesk(desk.id, session.staffId, session.deskId);
      const deptData = result.departments as any;
      setSession({
        ...session,
        deskId: result.id,
        deskName: (result.display_name ?? result.name) as string,
        departmentId: deptData?.id ?? result.department_id ?? session.departmentId,
        departmentName: deptData?.name ?? session.departmentName,
      });
      setDeskPickerVisible(false);
      Alert.alert(t('desk.deskChanged'), t('desk.deskChangedMsg', { desk: result.display_name ?? result.name }));
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setSwitching(false);
    }
  };

  // ── Customer View ───────────────────────────────────────────────
  const handleCustomerView = () => {
    // Navigate to customer tabs without clearing session
    router.push('/(tabs)');
  };

  // ── Logout ─────────────────────────────────────────────────────
  const handleLogout = () => {
    Alert.alert(t('auth.signOut'), t('settings.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: async () => {
          // Close the desk
          if (session?.deskId) {
            try {
              await Actions.closeDeskStatus(session.deskId);
            } catch {}
          }
          await supabase.auth.signOut();
          clearSession();
          router.replace('/(tabs)');
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Local mode: Network Dashboard ── */}
      {isLocal && (
        <>
          {/* Network */}
          <View style={[styles.section, styles.localSection]}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="globe-outline" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>{t('settings.network')}</Text>
              <View style={[styles.statusPill, connectionStatus === 'connected' ? styles.statusPillOk : styles.statusPillErr]}>
                <View style={[styles.statusDot, { backgroundColor: connectionStatus === 'connected' ? '#22c55e' : colors.error }]} />
                <Text style={[styles.statusPillText, connectionStatus !== 'connected' && { color: colors.error }]}>
                  {connectionStatus === 'connected' ? t('connectStation.connected') : t('connectStation.disconnected')}
                </Text>
              </View>
            </View>

            {/* Station */}
            <View style={styles.netRow}>
              <View style={[styles.netIcon, { backgroundColor: 'rgba(59,130,246,0.12)' }]}>
                <Ionicons name="server-outline" size={16} color="#3b82f6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.netLabel}>{t('settings.station')}</Text>
                <Text style={styles.netValue}>{stationUrl}</Text>
              </View>
              <View style={[styles.netDot, { backgroundColor: connectionStatus === 'connected' ? '#22c55e' : colors.error }]} />
            </View>

            {/* Cloud Sync */}
            {syncStatus && (
              <View style={styles.netRow}>
                <View style={[styles.netIcon, { backgroundColor: syncStatus.isOnline ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)' }]}>
                  <Ionicons name="cloud-outline" size={16} color={syncStatus.isOnline ? '#22c55e' : '#f59e0b'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.netLabel}>{t('settings.cloudSync')}</Text>
                  <Text style={styles.netValue}>
                    {syncStatus.isOnline ? t('connectStation.syncing') : t('connectStation.offlineOnly')}
                    {syncStatus.pendingCount > 0 ? ` · ${syncStatus.pendingCount} pending` : ''}
                  </Text>
                </View>
                <View style={[styles.netDot, { backgroundColor: syncStatus.isOnline ? '#22c55e' : '#f59e0b' }]} />
              </View>
            )}

            {/* Kiosk */}
            {kioskInfo && (
              <View style={styles.netRow}>
                <View style={[styles.netIcon, { backgroundColor: 'rgba(168,85,247,0.12)' }]}>
                  <Ionicons name="tablet-portrait-outline" size={16} color="#a855f7" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.netLabel}>{t('settings.kiosk')}</Text>
                  <Text style={styles.netValue} numberOfLines={1}>{kioskInfo.kioskUrl}</Text>
                  {publicLinks?.kioskUrl ? (
                    <Text style={styles.netValueCloud} numberOfLines={1}>{publicLinks.kioskUrl}</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.viewBtn}
                  onPress={() => { setPreviewTitle(t('settings.kiosk')); setPreviewUrl(kioskInfo.kioskUrl); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="eye-outline" size={14} color={colors.primary} />
                  <Text style={styles.viewBtnText}>{t('settings.view')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Display */}
            {kioskInfo && (
              <View style={styles.netRow}>
                <View style={[styles.netIcon, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
                  <Ionicons name="tv-outline" size={16} color="#f59e0b" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.netLabel}>{t('settings.display')}</Text>
                  <Text style={styles.netValue} numberOfLines={1}>{kioskInfo.displayUrl}</Text>
                  {publicLinks?.displayUrl ? (
                    <Text style={styles.netValueCloud} numberOfLines={1}>{publicLinks.displayUrl}</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.viewBtn}
                  onPress={() => { setPreviewTitle(t('settings.display')); setPreviewUrl(kioskInfo.displayUrl); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="eye-outline" size={14} color={colors.primary} />
                  <Text style={styles.viewBtnText}>{t('settings.view')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Local IP */}
            {kioskInfo && (
              <View style={styles.netRow}>
                <View style={[styles.netIcon, { backgroundColor: 'rgba(100,116,139,0.12)' }]}>
                  <Ionicons name="locate-outline" size={16} color="#64748b" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.netLabel}>{t('settings.localIP')}</Text>
                  <Text style={styles.netValue}>{kioskInfo.localIP}</Text>
                </View>
              </View>
            )}

            {devices.filter((d) => d.type !== 'station').map((device) => {
                const icon = device.type === 'display' ? 'tv-outline'
                  : device.type === 'kiosk' ? 'tablet-portrait-outline'
                  : device.type === 'station' ? 'desktop-outline'
                  : 'phone-portrait-outline';
                const iconColor = device.type === 'display' ? '#f59e0b'
                  : device.type === 'kiosk' ? '#a855f7'
                  : device.type === 'station' ? '#3b82f6'
                  : '#64748b';
                return (
                  <View key={device.id} style={styles.deviceRow}>
                    <View style={[styles.netIcon, { backgroundColor: iconColor + '15' }]}>
                      <Ionicons name={icon as any} size={16} color={iconColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deviceName}>{device.name}</Text>
                      <Text style={styles.deviceMeta}>
                        {device.type.charAt(0).toUpperCase() + device.type.slice(1)}
                        {' · '}
                        {device.id.split('-').pop()}
                      </Text>
                    </View>
                    <View style={[styles.deviceStatusBadge, device.connected ? styles.deviceOnline : styles.deviceOffline]}>
                      <View style={[styles.deviceStatusDot, { backgroundColor: device.connected ? '#22c55e' : colors.error }]} />
                      <Text style={[styles.deviceStatusText, { color: device.connected ? '#22c55e' : colors.error }]}>
                        {device.connected ? t('settings.online') : t('settings.offline')}
                      </Text>
                    </View>
                  </View>
                );
              })}
          </View>
        </>
      )}

      {/* Current Desk */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Ionicons name="desktop-outline" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>{t('settings.currentDesk')}</Text>
        </View>

        <TouchableOpacity style={styles.stationCard} onPress={openDeskPicker} activeOpacity={0.7}>
          <View style={styles.stationIcon}>
            <Ionicons name="desktop-outline" size={24} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stationName}>{session?.deskName ?? t('settings.notAssigned')}</Text>
            <Text style={styles.stationSub}>
              {session?.officeName ?? ''}
              {session?.departmentName ? ` \u00B7 ${session.departmentName}` : ''}
            </Text>
          </View>
          <View style={styles.switchBadge}>
            <Ionicons name="swap-horizontal-outline" size={14} color={colors.primary} />
            <Text style={styles.switchBadgeText}>{t('settings.switch')}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Quick Actions — only in cloud mode */}
      {!isLocal && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="flash-outline" size={20} color={colors.warning} />
            <Text style={styles.sectionTitle}>{t('settings.quickActions')}</Text>
          </View>

          <TouchableOpacity style={styles.actionRow} onPress={handleCustomerView}>
            <View style={[styles.actionIcon, { backgroundColor: colors.info + '12' }]}>
              <Ionicons name="people-outline" size={20} color={colors.info} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>{t('settings.customerView')}</Text>
              <Text style={styles.actionSub}>{t('settings.customerViewSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          {isAdmin && (
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => router.navigate('/(admin)')}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#8b5cf6' + '12' }]}>
                <Ionicons name="shield-outline" size={20} color="#8b5cf6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>{t('settings.adminDashboard')}</Text>
                <Text style={styles.actionSub}>{t('settings.adminDashboardSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.actionRow} onPress={openDeskPicker}>
            <View style={[styles.actionIcon, { backgroundColor: colors.primary + '12' }]}>
              <Ionicons name="swap-horizontal-outline" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>{t('settings.switchDesk')}</Text>
              <Text style={styles.actionSub}>{t('settings.switchDeskSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Exit Local Mode ── */}
      {isLocal && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.exitLocalBtn}
            onPress={() => {
              Alert.alert(
                t('connectStation.exitLocalMode'),
                t('connectStation.exitLocalModeMsg'),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('connectStation.exitLocalMode'),
                    style: 'destructive',
                    onPress: () => {
                      disconnectStation();
                      clearSession();
                      // Small delay to let state clear before navigating
                      setTimeout(() => router.replace('/(tabs)'), 50);
                    },
                  },
                ],
              );
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="exit-outline" size={20} color="#ef4444" />
            <View style={{ flex: 1 }}>
              <Text style={styles.exitLocalBtnText}>{t('connectStation.exitLocalMode')}</Text>
              <Text style={styles.exitLocalBtnSub}>{t('connectStation.exitLocalModeSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      )}

      {/* Account — only in cloud mode */}
      {!isLocal && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutRow} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={colors.error} />
            <Text style={styles.logoutText}>{t('auth.signOut')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Desk Picker Modal */}
      <Modal visible={deskPickerVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('desk.switchDesk')}</Text>
              <TouchableOpacity onPress={() => setDeskPickerVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {loadingDesks ? (
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={{ marginVertical: spacing.xxl }}
              />
            ) : availableDesks.length === 0 ? (
              <View style={styles.emptyDesks}>
                <Ionicons name="desktop-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyDesksText}>{t('desk.noDesksAvailable')}</Text>
              </View>
            ) : (
              <FlatList
                data={availableDesks}
                keyExtractor={(d) => d.id}
                contentContainerStyle={{ padding: spacing.md }}
                renderItem={({ item }) => {
                  const isCurrent = item.id === session?.deskId;
                  const isOccupied = !!item.current_staff_id && item.current_staff_id !== session?.staffId;
                  const statusColor =
                    item.status === 'open'
                      ? colors.success
                      : item.status === 'on_break'
                        ? colors.warning
                        : colors.textMuted;

                  return (
                    <TouchableOpacity
                      style={[
                        styles.deskItem,
                        isCurrent && styles.deskItemCurrent,
                        isOccupied && { opacity: 0.5 },
                      ]}
                      onPress={() => !isCurrent && handleSwitchToDesk(item)}
                      disabled={isCurrent || switching}
                    >
                      <View style={styles.deskItemLeft}>
                        <View style={[styles.deskStatusDot, { backgroundColor: statusColor }]} />
                        <View>
                          <Text style={styles.deskItemName}>
                            {item.display_name ?? item.name}
                          </Text>
                          <Text style={styles.deskItemSub}>
                            {(item.departments as any)?.name ?? t('settings.general')}
                            {isOccupied ? ` \u00B7 ${t('desk.occupied')}` : ''}
                            {isCurrent ? ` \u00B7 ${t('desk.current')}` : ''}
                          </Text>
                        </View>
                      </View>
                      {isCurrent ? (
                        <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                      ) : !isOccupied ? (
                        <Ionicons name="arrow-forward-circle-outline" size={22} color={colors.primary} />
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            {switching && (
              <View style={styles.switchingOverlay}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.switchingText}>{t('desk.switchingDesk')}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* WebView Preview Modal */}
      <Modal visible={!!previewUrl} animationType="slide" statusBarTranslucent onRequestClose={() => setPreviewUrl(null)}>
        <View style={[styles.previewContainer, { paddingTop: insets.top }]}>
          <View style={styles.previewHeader}>
            <TouchableOpacity onPress={() => setPreviewUrl(null)} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.previewTitle} numberOfLines={1}>{previewTitle}</Text>
            <View style={{ width: 24 }} />
          </View>
          {previewUrl && (
            <WebView
              source={{ uri: previewUrl }}
              style={{ flex: 1 }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.previewLoading}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              )}
              javaScriptEnabled
              domStorageEnabled
            />
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  // Section
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },

  // Station card (tappable)
  stationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primary + '08',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '20',
  },
  stationIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stationName: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  stationSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 1,
  },
  switchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary + '12',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: borderRadius.full,
  },
  switchBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },

  // Action rows
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  actionSub: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
  },

  // Logout
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  logoutText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.error,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '75%',
    paddingBottom: spacing.xxl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },

  // Desk items
  deskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xs,
  },
  deskItemCurrent: {
    backgroundColor: colors.success + '10',
  },
  deskItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  deskStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  deskItemName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  deskItemSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 1,
  },

  // Empty
  emptyDesks: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  emptyDesksText: {
    fontSize: fontSize.md,
    color: colors.textMuted,
  },

  // Local mode section
  localSection: {
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
    backgroundColor: 'rgba(34, 197, 94, 0.04)',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusPillOk: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  statusPillErr: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  statusPillText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: '#22c55e',
  },
  infoSub: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: -4,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  syncText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },

  // Exit local mode
  exitLocalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  exitLocalBtnText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#ef4444',
  },
  exitLocalBtnSub: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
  },

  // Network dashboard (local mode)
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  netIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  netLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  netValue: {
    fontSize: fontSize.sm,
    color: colors.text,
    marginTop: 1,
  },
  netValueCloud: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  netDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Sub-header (devices within network card)
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  subHeaderText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  // View button (inline on endpoint rows)
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '12',
  },
  viewBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },

  // WebView preview modal
  previewContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  previewTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  previewLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },

  // Devices (local mode)
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  deviceName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  deviceMeta: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  deviceStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  deviceOnline: {
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
  },
  deviceOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
  },
  deviceStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  deviceStatusText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  deviceCount: {
    marginLeft: 'auto',
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    backgroundColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  emptyDevices: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyDevicesText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },

  // Switching overlay
  switchingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
  },
  switchingText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
});
