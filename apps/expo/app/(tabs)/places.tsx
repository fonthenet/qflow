import { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppStore, type SavedPlace } from '@/lib/store';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Business card
// ---------------------------------------------------------------------------
function PlaceCard({
  place,
  visitCount,
  onPress,
  onRemove,
  colors,
  isDark,
}: {
  place: SavedPlace;
  visitCount: number;
  onPress: () => void;
  onRemove: () => void;
  colors: any;
  isDark: boolean;
}) {
  const dateStr = place.lastSeenAt
    ? new Date(place.lastSeenAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.cardTop}>
        <View
          style={[
            styles.cardIcon,
            { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.infoLight },
          ]}
        >
          <Ionicons name="business-outline" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
            {place.name}
          </Text>
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
              {visitCount} ticket{visitCount !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </View>

      {/* CTA row */}
      <View style={styles.cardActions}>
        <View
          style={[
            styles.viewQueuesBtn,
            { backgroundColor: colors.primary },
          ]}
        >
          <Ionicons name="people-outline" size={15} color="#fff" />
          <Text style={styles.viewQueuesBtnText}>View Queues</Text>
          <Ionicons name="chevron-forward" size={14} color="#fff" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ===========================================================================
// Main screen
// ===========================================================================
export default function PlacesScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { savedPlaces, removePlace, history } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  // Count tickets per office from history
  const visitCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of history) {
      if (entry.officeId) {
        counts[entry.officeId] = (counts[entry.officeId] ?? 0) + 1;
      }
    }
    return counts;
  }, [history]);

  // Sort by lastSeenAt descending
  const sorted = useMemo(
    () =>
      [...savedPlaces].sort(
        (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
      ),
    [savedPlaces]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.address ?? '').toLowerCase().includes(q)
    );
  }, [sorted, search]);

  const handleOpen = (place: SavedPlace) => {
    if (place.kioskSlug) {
      router.push(`/queue-peek/${place.kioskSlug}` as any);
    } else if (place.joinToken) {
      router.push(`/join/${place.joinToken}` as any);
    }
  };

  const handleScan = () => {
    router.push('/scan' as any);
  };

  // =======================================================================
  // Empty state
  // =======================================================================
  if (savedPlaces.length === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.emptyIconCircle,
            { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.infoLight },
          ]}
        >
          <Ionicons name="storefront-outline" size={56} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No places yet</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Scan a business QR code to add it here. You'll be able to check wait times and join queues without scanning again.
        </Text>
        <TouchableOpacity
          style={[styles.emptyAction, { backgroundColor: colors.primary }]}
          onPress={handleScan}
          activeOpacity={0.7}
        >
          <Ionicons name="qr-code-outline" size={20} color="#fff" />
          <Text style={styles.emptyActionText}>Scan QR Code</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // =======================================================================
  // Main view
  // =======================================================================
  return (
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
      {/* Search bar */}
      <View
        style={[
          styles.searchBar,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search places..."
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

      {/* Scan banner */}
      <TouchableOpacity
        style={[
          styles.scanBanner,
          {
            backgroundColor: isDark ? 'rgba(59,130,246,0.10)' : colors.infoLight,
            borderColor: colors.primary + '20',
          },
        ]}
        onPress={handleScan}
        activeOpacity={0.7}
      >
        <View style={[styles.scanBannerIcon, { backgroundColor: colors.primary }]}>
          <Ionicons name="qr-code-outline" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.scanBannerTitle, { color: colors.text }]}>Add a new place</Text>
          <Text style={[styles.scanBannerSub, { color: colors.textSecondary }]}>
            Scan a QR code to save a business
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Count */}
      <Text style={[styles.countLabel, { color: colors.textMuted }]}>
        {filtered.length} place{filtered.length !== 1 ? 's' : ''}
      </Text>

      {/* Place list */}
      {filtered.length === 0 ? (
        <View style={styles.noResults}>
          <Ionicons name="search-outline" size={32} color={colors.textMuted} />
          <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>
            No places match your search.
          </Text>
        </View>
      ) : (
        filtered.map((place) => (
          <PlaceCard
            key={place.id}
            place={place}
            visitCount={visitCounts[place.id] ?? place.visitCount}
            onPress={() => handleOpen(place)}
            onRemove={() => removePlace(place.id)}
            colors={colors}
            isDark={isDark}
          />
        ))
      )}
    </ScrollView>
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
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
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
  emptyActionText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#fff',
  },

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
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    height: '100%',
  },

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
  scanBannerTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  scanBannerSub: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },

  countLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardName: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  cardSub: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  cardMeta: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingLeft: 44 + spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: fontSize.xs,
  },
  cardActions: {
    marginTop: spacing.md,
  },
  viewQueuesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
  },
  viewQueuesBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: '#fff',
  },

  noResults: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: spacing.md,
  },
  noResultsText: {
    fontSize: fontSize.md,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 22,
  },
});
