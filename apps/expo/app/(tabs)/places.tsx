import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppStore, type SavedPlace } from '@/lib/store';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';
import { fetchQueueStatus, searchDirectory, type QueueStatusResponse, type DirectorySearchResult } from '@/lib/api';
import { checkWaitAlertsNow } from '@/lib/wait-alerts';
import { formatDate } from '@/lib/format-date';
import { API_BASE_URL } from '@/lib/config';

type ThemeColors = ReturnType<typeof useTheme>['colors'];

// ---------------------------------------------------------------------------
// Live queue status cache (per-place)
// ---------------------------------------------------------------------------
type StatusEntry = {
  loading: boolean;
  status: QueueStatusResponse | null;
  failed: boolean;
};

type StatusMap = Record<string, StatusEntry>;

/**
 * Returns the pill to show, or `null` if we shouldn't show one yet.
 * We only know if a place is "open" / "busy" / "closed" after we've
 * successfully (or unsuccessfully) fetched its queue status — and we can
 * only fetch status for places that have a kiosk slug. For join-token-only
 * places we simply omit the pill.
 */
function statusBadge(
  entry: StatusEntry | undefined,
  hasSlug: boolean,
  colors: ThemeColors,
  t: (k: string, o?: any) => string,
): { label: string; color: string; dot: string } | null {
  // No kiosk slug → we can't determine open/closed at all
  if (!hasSlug) return null;
  // Still loading the first result → show nothing yet
  if (!entry || (entry.loading && !entry.status && !entry.failed)) return null;
  if (entry.failed) {
    return {
      label: t('places.closed'),
      color: colors.textMuted,
      dot: colors.textMuted,
    };
  }
  // Closed per operating hours (and not 24/7) → show Closed
  if (entry.status && entry.status.openNow === false && !entry.status.alwaysOpen) {
    return {
      label: t('queuePeek.closedNow', { defaultValue: 'Closed' }),
      color: colors.error,
      dot: colors.error,
    };
  }
  const waiting = entry.status?.totalWaiting ?? 0;
  if (waiting >= 15) {
    return {
      label: t('places.busy'),
      color: colors.warning,
      dot: colors.warning,
    };
  }
  return {
    label: t('places.open'),
    color: colors.success,
    dot: colors.success,
  };
}

// ---------------------------------------------------------------------------
// Business card
// ---------------------------------------------------------------------------
function PlaceCard({
  place,
  visitCount,
  statusEntry,
  activeTicketPosition,
  onPress,
  onBook,
  onLongPress,
  onRemove,
  colors,
  isDark,
}: {
  place: SavedPlace;
  visitCount: number;
  statusEntry: StatusEntry | undefined;
  activeTicketPosition: number | null;
  onPress: () => void;
  onBook: (() => void) | null;
  onLongPress: () => void;
  onRemove: () => void;
  colors: ThemeColors;
  isDark: boolean;
}) {
  const { t, i18n } = useTranslation();
  const dateStr = place.lastSeenAt
    ? formatDate(place.lastSeenAt, place.timezone, i18n.language)
    : null;

  const hasSlug = !!place.kioskSlug;
  const badge = statusBadge(statusEntry, hasSlug, colors, t);
  const hasLiveData = !!statusEntry?.status && !statusEntry.failed;
  const waiting = hasLiveData ? statusEntry!.status!.totalWaiting : null;
  const estWait = hasLiveData
    ? statusEntry!.status!.departments?.[0]?.estimatedWaitMinutes ?? null
    : null;
  const showStatusRow = !!badge || waiting != null || place.waitAlertThreshold != null;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      activeOpacity={0.78}
    >
      {/* Active ticket pill (top) */}
      {activeTicketPosition != null && (
        <View style={[styles.activeBar, { backgroundColor: colors.success + '22' }]}>
          <Ionicons name="navigate" size={13} color={colors.success} />
          <Text style={[styles.activeBarText, { color: colors.success }]}>
            {t('places.youreInQueue')}
            {activeTicketPosition > 0 ? ` · ${t('places.position', { count: activeTicketPosition })}` : ''}
          </Text>
        </View>
      )}

      <View style={styles.cardTop}>
        {/* Logo (if we have one) or the building icon fallback */}
        {place.logo_url ? (
          <Image source={{ uri: place.logo_url }} style={styles.cardLogo} resizeMode="cover" />
        ) : (
          <View
            style={[
              styles.cardIcon,
              { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.infoLight },
            ]}
          >
            <Ionicons name="business-outline" size={22} color={colors.primary} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.cardNameRow}>
            <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
              {place.name}
            </Text>
            {place.isPinned && (
              <Ionicons name="pin" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
            )}
          </View>
          {place.address && (
            <Text style={[styles.cardSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {place.address}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={onRemove}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Status / live info row (only when we have something to say) */}
      {showStatusRow && (
        <View style={styles.statusRow}>
          {badge && (
            <View style={styles.statusPill}>
              <View style={[styles.statusDot, { backgroundColor: badge.dot }]} />
              <Text style={[styles.statusLabel, { color: badge.color }]}>{badge.label}</Text>
            </View>
          )}
          {waiting != null && (
            <>
              {badge && <View style={[styles.dot, { backgroundColor: colors.textMuted }]} />}
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {t('places.waiting', { count: waiting })}
              </Text>
            </>
          )}
          {estWait != null && estWait > 0 && (
            <>
              <View style={[styles.dot, { backgroundColor: colors.textMuted }]} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {t('places.waitMinutes', { count: estWait })}
              </Text>
            </>
          )}
          {place.waitAlertThreshold != null && (
            <Ionicons
              name="notifications"
              size={12}
              color={colors.primary}
              style={{ marginLeft: 'auto' }}
            />
          )}
        </View>
      )}

      {/* Warning when a kiosk link we can poll actually fails */}
      {hasSlug && statusEntry?.failed && !statusEntry.loading && (
        <View style={[styles.warnBar, { backgroundColor: colors.warning + '18' }]}>
          <Ionicons name="warning-outline" size={12} color={colors.warning} />
          <Text style={[styles.warnText, { color: colors.warning }]}>
            {t('places.linkBroken')}
          </Text>
        </View>
      )}

      <View style={styles.cardMeta}>
        {dateStr && (
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={13} color={colors.textMuted} />
            <Text style={[styles.metaText, { color: colors.textMuted }]}>{dateStr}</Text>
          </View>
        )}
        {visitCount > 0 && (
          <View style={styles.metaItem}>
            <Ionicons name="receipt-outline" size={13} color={colors.textMuted} />
            <Text style={[styles.metaText, { color: colors.textMuted }]}>
              {t('places.ticket', { count: visitCount })}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.cardActions}>
        <View style={[styles.viewQueuesBtn, { backgroundColor: colors.primary }]}>
          <Ionicons name="people-outline" size={15} color="#fff" />
          <Text style={styles.viewQueuesBtnText}>{t('places.viewQueues')}</Text>
        </View>
        {onBook && (
          <TouchableOpacity
            style={[
              styles.bookBtn,
              { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
            ]}
            onPress={onBook}
            activeOpacity={0.75}
          >
            <Ionicons name="calendar-outline" size={15} color={colors.primary} />
            <Text style={[styles.bookBtnText, { color: colors.primary }]}>
              {t('places.book')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Action sheet modal (long-press)
// ---------------------------------------------------------------------------
function ActionSheet({
  place,
  visible,
  onDismiss,
  onPin,
  onShare,
  onSetWaitAlert,
  onClearWaitAlert,
  onRemove,
  colors,
}: {
  place: SavedPlace | null;
  visible: boolean;
  onDismiss: () => void;
  onPin: () => void;
  onShare: () => void;
  onSetWaitAlert: () => void;
  onClearWaitAlert: () => void;
  onRemove: () => void;
  colors: ThemeColors;
}) {
  const { t } = useTranslation();
  if (!place) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.modalBackdrop} onPress={onDismiss}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.borderLight },
          ]}
          onPress={() => {}}
        >
          <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
            {place.name}
          </Text>

          <SheetRow
            icon={place.isPinned ? 'pin-outline' : 'pin'}
            label={place.isPinned ? t('places.unpin') : t('places.pin')}
            onPress={onPin}
            colors={colors}
          />
          <SheetRow
            icon="share-outline"
            label={t('places.share')}
            onPress={onShare}
            colors={colors}
          />
          {place.waitAlertThreshold != null ? (
            <SheetRow
              icon="notifications-off-outline"
              label={t('places.clearWaitAlert')}
              onPress={onClearWaitAlert}
              colors={colors}
            />
          ) : (
            <SheetRow
              icon="notifications-outline"
              label={t('places.setWaitAlert')}
              onPress={onSetWaitAlert}
              colors={colors}
              disabled={!place.kioskSlug}
            />
          )}
          <SheetRow
            icon="trash-outline"
            label={t('places.remove')}
            onPress={onRemove}
            colors={colors}
            destructive
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetRow({
  icon,
  label,
  onPress,
  colors,
  destructive,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.sheetRow, { opacity: disabled ? 0.4 : 1 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.6}
    >
      <Ionicons
        name={icon}
        size={20}
        color={destructive ? colors.error : colors.text}
      />
      <Text
        style={[
          styles.sheetRowLabel,
          { color: destructive ? colors.error : colors.text },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Wait-alert threshold picker
// ---------------------------------------------------------------------------
function WaitAlertPicker({
  visible,
  onDismiss,
  onPick,
  colors,
}: {
  visible: boolean;
  onDismiss: () => void;
  onPick: (threshold: number) => void;
  colors: ThemeColors;
}) {
  const { t } = useTranslation();
  const options = [1, 3, 5, 10];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.modalBackdrop} onPress={onDismiss}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.borderLight },
          ]}
          onPress={() => {}}
        >
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            {t('places.waitAlertPrompt')}
          </Text>
          <View style={styles.pickerRow}>
            {options.map((n) => (
              <TouchableOpacity
                key={n}
                style={[
                  styles.pickerChip,
                  { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
                ]}
                onPress={() => onPick(n)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pickerChipText, { color: colors.primary }]}>
                  ≤ {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ===========================================================================
// Main screen
// ===========================================================================
export default function PlacesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const {
    savedPlaces,
    removePlace,
    togglePinPlace,
    setWaitAlert,
    markPlaceOk,
    markPlaceFailed,
    setPlaceBookingMode,
    recordPlace,
    history,
    activeTicket,
  } = useAppStore();

  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<StatusMap>({});
  const [sheetPlace, setSheetPlace] = useState<SavedPlace | null>(null);
  const [alertPlace, setAlertPlace] = useState<SavedPlace | null>(null);
  const [directoryResults, setDirectoryResults] = useState<DirectorySearchResult[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [addingOfficeId, setAddingOfficeId] = useState<string | null>(null);
  const [addedBanner, setAddedBanner] = useState<string | null>(null);

  // Keep a stable ref to savedPlaces so the search effect only re-runs on
  // query changes (savedPlaces re-identifies on every status poll, which was
  // causing the spinner to flash every 60s).
  const savedPlacesRef = useRef(savedPlaces);
  savedPlacesRef.current = savedPlaces;

  // Debounced directory search — fires as soon as the user types anything.
  useEffect(() => {
    const q = search.trim();
    if (q.length === 0) {
      setDirectoryResults([]);
      setDirectoryLoading(false);
      return;
    }
    let cancelled = false;
    setDirectoryLoading(true);
    const timer = setTimeout(async () => {
      const results = await searchDirectory(q);
      if (cancelled) return;
      const savedOfficeIds = new Set(savedPlacesRef.current.map((p) => p.id));
      setDirectoryResults(results.filter((r) => !savedOfficeIds.has(r.officeId)));
      setDirectoryLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  // --- Live queue status fetcher -----------------------------------------
  // NOTE: we intentionally read savedPlaces via a ref here. markPlaceOk and
  // setPlaceBookingMode produce a new savedPlaces array on every call, which
  // — if this callback depended on savedPlaces directly — would change its
  // identity, re-trigger the useFocusEffect below, and recurse forever.
  const fetchAllStatuses = useCallback(async () => {
    const slugs = savedPlacesRef.current
      .filter((p) => p.kioskSlug)
      .map((p) => ({ id: p.id, slug: p.kioskSlug! }));
    if (slugs.length === 0) return;

    // Mark all loading
    setStatusMap((prev) => {
      const next = { ...prev };
      for (const s of slugs) {
        next[s.id] = { loading: true, status: prev[s.id]?.status ?? null, failed: false };
      }
      return next;
    });

    await Promise.all(
      slugs.map(async ({ id, slug }) => {
        const status = await fetchQueueStatus(slug);
        setStatusMap((prev) => ({
          ...prev,
          [id]: { loading: false, status, failed: !status },
        }));
        if (status) {
          markPlaceOk(id);
          // Keep bookingMode fresh — the org may have toggled it since scan
          if (status.bookingMode !== undefined) {
            setPlaceBookingMode(id, status.bookingMode ?? null);
          }
        } else {
          markPlaceFailed(id);
        }
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markPlaceOk, markPlaceFailed, setPlaceBookingMode]);

  // Fetch on focus + refresh every 60s while focused
  const focusTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useFocusEffect(
    useCallback(() => {
      void fetchAllStatuses();
      focusTimer.current = setInterval(() => {
        void fetchAllStatuses();
      }, 60_000);
      return () => {
        if (focusTimer.current) clearInterval(focusTimer.current);
        focusTimer.current = null;
      };
    }, [fetchAllStatuses]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchAllStatuses(), checkWaitAlertsNow()]);
    setRefreshing(false);
  }, [fetchAllStatuses]);

  // --- Derived data ------------------------------------------------------
  const visitCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of history) {
      if (entry.officeId) {
        counts[entry.officeId] = (counts[entry.officeId] ?? 0) + 1;
      }
    }
    return counts;
  }, [history]);

  const verticals = useMemo(() => {
    const set = new Set<string>();
    for (const p of savedPlaces) {
      if (p.vertical) set.add(p.vertical);
    }
    return Array.from(set).sort();
  }, [savedPlaces]);

  // Sort + filter + group
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (p: SavedPlace) => {
      if (categoryFilter && p.vertical !== categoryFilter) return false;
      if (!q) return true;
      if (p.name.toLowerCase().includes(q)) return true;
      if ((p.address ?? '').toLowerCase().includes(q)) return true;
      if (p.services?.some((s) => s.includes(q))) return true;
      return false;
    };
    return savedPlaces.filter(matches);
  }, [savedPlaces, search, categoryFilter]);

  const { pinned, recent, older } = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const pins: SavedPlace[] = [];
    const rec: SavedPlace[] = [];
    const old: SavedPlace[] = [];
    for (const p of filtered) {
      if (p.isPinned) pins.push(p);
      else if (new Date(p.lastSeenAt).getTime() >= sevenDaysAgo) rec.push(p);
      else old.push(p);
    }
    const byRecency = (a: SavedPlace, b: SavedPlace) =>
      new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    return {
      pinned: pins.sort(byRecency),
      recent: rec.sort(byRecency),
      older: old.sort(byRecency),
    };
  }, [filtered]);

  // --- Active ticket binding --------------------------------------------
  const activeTicketOfficeId = activeTicket?.office?.id ?? null;
  const activeTicketPosition = activeTicket?.position ?? null;

  // --- Handlers ----------------------------------------------------------
  const handleOpen = (place: SavedPlace) => {
    if (place.kioskSlug) {
      router.push(`/queue-peek/${place.kioskSlug}` as any);
    } else if (place.joinToken) {
      router.push(`/join/${place.joinToken}` as any);
    } else {
      Alert.alert(t('places.linkBroken'));
    }
  };

  const confirmRemove = (place: SavedPlace) => {
    Alert.alert(
      t('places.removeTitle'),
      t('places.removeMessage', { name: place.name }),
      [
        { text: t('places.cancel'), style: 'cancel' },
        {
          text: t('places.remove'),
          style: 'destructive',
          onPress: () => {
            removePlace(place.id);
            setSheetPlace(null);
          },
        },
      ],
    );
  };

  const handleShare = async (place: SavedPlace) => {
    const token = place.joinToken;
    const slug = place.kioskSlug;
    const url = token
      ? `${API_BASE_URL}/q/${token}`
      : slug
      ? `${API_BASE_URL}/k/${slug}`
      : null;
    if (!url) return;
    try {
      await Share.share({
        message: `${t('places.shareMessage', { name: place.name })} ${url}`,
        url,
        title: place.name,
      });
    } catch {
      // user cancelled — ignore
    } finally {
      setSheetPlace(null);
    }
  };

  const handleSetWaitAlert = (place: SavedPlace, threshold: number) => {
    setWaitAlert(place.id, threshold);
    setAlertPlace(null);
    setSheetPlace(null);
    Alert.alert(t('places.waitAlertSet', { count: threshold }));
  };

  const handleClearWaitAlert = (place: SavedPlace) => {
    setWaitAlert(place.id, null);
    setSheetPlace(null);
    Alert.alert(t('places.waitAlertCleared'));
  };

  const renderCard = (place: SavedPlace) => {
    const canBook =
      !!place.kioskSlug &&
      !!place.bookingMode &&
      place.bookingMode !== 'disabled' &&
      place.bookingMode !== 'simple';
    return (
      <PlaceCard
        key={place.id}
        place={place}
        visitCount={visitCounts[place.id] ?? 0}
        statusEntry={statusMap[place.id]}
        activeTicketPosition={
          activeTicketOfficeId === place.id ? activeTicketPosition : null
        }
        onPress={() => handleOpen(place)}
        onBook={
          canBook
            ? () => router.push(`/book-appointment/${place.kioskSlug}` as any)
            : null
        }
        onLongPress={() => setSheetPlace(place)}
        onRemove={() => confirmRemove(place)}
        colors={colors}
        isDark={isDark}
      />
    );
  };

  const renderSection = (label: string, items: SavedPlace[]) => {
    if (items.length === 0) return null;
    return (
      <View key={label}>
        <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>{label}</Text>
        {items.map(renderCard)}
      </View>
    );
  };

  // =======================================================================
  // Main view
  // =======================================================================
  const isEmpty = savedPlaces.length === 0;
  return (
    <>
      {addedBanner && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: spacing.md,
            left: spacing.md,
            right: spacing.md,
            zIndex: 50,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingVertical: 10,
            paddingHorizontal: spacing.md,
            borderRadius: borderRadius.md,
            backgroundColor: colors.success,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.18,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          <Ionicons name="checkmark-circle" size={20} color="#fff" />
          <Text style={{ flex: 1, color: '#fff', fontWeight: '700', fontSize: fontSize.sm }} numberOfLines={1}>
            {t('places.addedToPlaces', {
              name: addedBanner,
              defaultValue: '{{name}} added to Places',
            })}
          </Text>
        </View>
      )}
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Search bar + compact Add button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
          <View
            style={[
              styles.searchBar,
              { flex: 1, marginBottom: 0, backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder={
                isEmpty
                  ? t('places.findPlaceholder', { defaultValue: 'Search businesses to add…' })
                  : t('places.searchPlaces')
              }
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            accessibilityLabel={t('places.addNewPlace')}
            onPress={() => router.push('/scan' as any)}
            activeOpacity={0.8}
            style={{
              width: 44,
              height: 44,
              borderRadius: borderRadius.md,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="qr-code-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Category chips */}
        {verticals.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsRow}
            contentContainerStyle={{ paddingHorizontal: spacing.xs, gap: spacing.xs }}
          >
            <CategoryChip
              label={t('places.allCategories')}
              active={categoryFilter === null}
              onPress={() => setCategoryFilter(null)}
              colors={colors}
            />
            {verticals.map((v) => (
              <CategoryChip
                key={v}
                label={v}
                active={categoryFilter === v}
                onPress={() => setCategoryFilter(v)}
                colors={colors}
              />
            ))}
          </ScrollView>
        )}

        {/* When searching, render a single flat list that merges matching
            saved places + public directory results — no sub-section headers,
            no count. When not searching, fall back to the normal sectioned
            view (Pinned / Recent / Older). */}
        {search.trim().length >= 1 ? (
          <>
            {filtered.map(renderCard)}
            {directoryResults.map((r) => {
              const isAdding = addingOfficeId === r.officeId;
              return (
                <TouchableOpacity
                  key={r.officeId}
                  activeOpacity={0.6}
                  disabled={isAdding}
                  onPress={async () => {
                    // Give the tap something loud to do: haptic, a transient
                    // "adding" spinner on the row, then a confirmation banner
                    // before we clear the search and drop the user back on
                    // their list. Without this the tap felt like a no-op
                    // because the search UI just collapsed.
                    setAddingOfficeId(r.officeId);
                    try {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    } catch {
                      /* haptics unavailable — non-fatal */
                    }
                    recordPlace({
                      id: r.officeId,
                      name: r.orgName,
                      address: r.address,
                      kioskSlug: r.kioskSlug,
                      logo_url: r.logoUrl,
                      vertical: r.category ?? null,
                    });
                    setAddedBanner(r.orgName);
                    // Small delay so the user sees the added-state before the
                    // search view collapses.
                    setTimeout(() => {
                      setAddingOfficeId(null);
                      setSearch('');
                    }, 350);
                    setTimeout(() => {
                      setAddedBanner((current) =>
                        current === r.orgName ? null : current,
                      );
                    }, 2400);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    padding: spacing.md,
                    marginHorizontal: spacing.md,
                    marginTop: spacing.xs,
                    borderRadius: borderRadius.md,
                    backgroundColor: isAdding ? colors.primary + '14' : colors.surface,
                    borderWidth: 1,
                    borderColor: isAdding ? colors.primary : colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: colors.primary + '1A',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isAdding ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons name="storefront-outline" size={20} color={colors.primary} />
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.text }}
                      numberOfLines={1}
                    >
                      {r.orgName}
                    </Text>
                    <Text
                      style={{ fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 }}
                      numberOfLines={1}
                    >
                      {[r.officeName, r.address].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {isAdding ? (
                    <Text style={{ fontSize: fontSize.sm, fontWeight: '700', color: colors.primary }}>
                      {t('places.adding', { defaultValue: 'Adding…' })}
                    </Text>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="add-circle" size={22} color={colors.primary} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}

            {directoryLoading && (
              <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.primary} />
            )}

            {!directoryLoading && filtered.length === 0 && directoryResults.length === 0 && (
              <View style={styles.noResults}>
                <Ionicons name="search-outline" size={32} color={colors.textMuted} />
                <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>
                  {t('common.noResults')}
                </Text>
              </View>
            )}
          </>
        ) : isEmpty ? (
          <View style={{ alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.md }}>
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.infoLight },
              ]}
            >
              <Ionicons name="storefront-outline" size={56} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('places.noPlaces')}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              {t('places.noPlacesMsg')}
            </Text>
            <Text
              style={{
                fontSize: fontSize.sm,
                color: colors.textMuted,
                textAlign: 'center',
                marginBottom: spacing.md,
                maxWidth: 300,
              }}
            >
              {t('places.searchHint', {
                defaultValue: 'Search by name, service, or city above — or scan a QR at the counter.',
              })}
            </Text>
            <TouchableOpacity
              style={[styles.emptyAction, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/scan' as any)}
              activeOpacity={0.7}
            >
              <Ionicons name="qr-code-outline" size={20} color="#fff" />
              <Text style={styles.emptyActionText}>{t('places.scanQR')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Count */}
            <Text style={[styles.countLabel, { color: colors.textMuted }]}>
              {t('places.count', { count: filtered.length })}
            </Text>

            {filtered.length === 0 ? (
              <View style={styles.noResults}>
                <Ionicons name="search-outline" size={32} color={colors.textMuted} />
                <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>
                  {t('common.noResults')}
                </Text>
              </View>
            ) : (
              <>
                {renderSection(t('places.pinned'), pinned)}
                {renderSection(t('places.recent'), recent)}
                {renderSection(t('places.older'), older)}
              </>
            )}
          </>
        )}

        {refreshing && Object.keys(statusMap).length === 0 && (
          <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.primary} />
        )}
      </ScrollView>

      <ActionSheet
        place={sheetPlace}
        visible={!!sheetPlace}
        onDismiss={() => setSheetPlace(null)}
        onPin={() => {
          if (sheetPlace) togglePinPlace(sheetPlace.id);
          setSheetPlace(null);
        }}
        onShare={() => sheetPlace && handleShare(sheetPlace)}
        onSetWaitAlert={() => {
          if (sheetPlace) {
            setAlertPlace(sheetPlace);
            setSheetPlace(null);
          }
        }}
        onClearWaitAlert={() => sheetPlace && handleClearWaitAlert(sheetPlace)}
        onRemove={() => sheetPlace && confirmRemove(sheetPlace)}
        colors={colors}
      />

      <WaitAlertPicker
        visible={!!alertPlace}
        onDismiss={() => setAlertPlace(null)}
        onPick={(n) => alertPlace && handleSetWaitAlert(alertPlace, n)}
        colors={colors}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Category chip
// ---------------------------------------------------------------------------
function CategoryChip({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.catChip,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.primary + '14' : 'transparent',
        },
      ]}
    >
      <Text
        style={[
          styles.catChipText,
          { color: active ? colors.primary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Shortcut to the My-appointments screen (renders only when the user has
// local bookings on this device). Keeps appointment management one tap away
// from the Places tab without adding a new bottom-tab entry.
// ---------------------------------------------------------------------------
function AppointmentsShortcut({ colors }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const router = useRouter();
  const savedAppointments = useAppStore((s) => s.savedAppointments);
  const upcomingCount = useMemo(() => {
    const now = Date.now();
    return savedAppointments.filter((a) => {
      if (a.hidden) return false;
      if (['cancelled', 'completed', 'no_show'].includes(a.status)) return false;
      return new Date(a.scheduledAt).getTime() >= now - 2 * 3600_000;
    }).length;
  }, [savedAppointments]);

  if (savedAppointments.length === 0) return null;

  return (
    <TouchableOpacity
      onPress={() => router.push('/(tabs)/history' as any)}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: 10,
        borderRadius: borderRadius.lg,
        backgroundColor: colors.primary + '12',
        borderWidth: 1,
        borderColor: colors.primary + '30',
        marginBottom: spacing.sm,
      }}
    >
      <Ionicons name="calendar-outline" size={18} color={colors.primary} />
      <Text style={{ flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.primary }}>
        {t('appointments.shortcut', { count: upcomingCount })}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={colors.primary} />
    </TouchableOpacity>
  );
}

// ===========================================================================
// Styles
// ===========================================================================
const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: '700', marginBottom: spacing.xs },
  emptySubtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
    marginBottom: spacing.lg,
  },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    borderRadius: borderRadius.full,
  },
  emptyActionText: { fontSize: fontSize.md, fontWeight: '600', color: '#fff' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: fontSize.md, height: '100%' },

  chipsRow: { marginBottom: spacing.sm },
  catChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginRight: 6,
  },
  catChipText: { fontSize: fontSize.xs, fontWeight: '600', textTransform: 'capitalize' },

  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  scanBannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanBannerTitle: { fontSize: fontSize.md, fontWeight: '600' },
  scanBannerSub: { fontSize: fontSize.xs, marginTop: 1 },

  countLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },

  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  activeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  activeBarText: { fontSize: fontSize.xs, fontWeight: '700' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#0002',
  },
  cardNameRow: { flexDirection: 'row', alignItems: 'center' },
  cardName: { fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  cardSub: { fontSize: fontSize.sm, marginTop: 1 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingLeft: 44 + spacing.md,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontSize: fontSize.xs, fontWeight: '700' },
  dot: { width: 3, height: 3, borderRadius: 2, marginHorizontal: 2 },

  warnBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
    marginLeft: 44 + spacing.md,
    alignSelf: 'flex-start',
  },
  warnText: { fontSize: 11, fontWeight: '600' },

  cardMeta: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xs,
    paddingLeft: 44 + spacing.md,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: fontSize.xs },

  cardActions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  viewQueuesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
  },
  viewQueuesBtnText: { fontSize: fontSize.sm, fontWeight: '600', color: '#fff' },
  bookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
  },
  bookBtnText: { fontSize: fontSize.sm, fontWeight: '700' },

  noResults: { alignItems: 'center', paddingVertical: 48, gap: spacing.md },
  noResultsText: {
    fontSize: fontSize.md,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 22,
  },

  // Modal sheet
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  sheetTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
  },
  sheetRowLabel: { fontSize: fontSize.md, fontWeight: '600' },

  pickerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    justifyContent: 'center',
  },
  pickerChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
  },
  pickerChipText: { fontSize: fontSize.md, fontWeight: '700' },
});
