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
import { useAppStore } from '@/lib/store';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Derive unique businesses from visit history
// ---------------------------------------------------------------------------
interface DerivedBusiness {
  id: string;
  name: string;
  lastService: string;
  lastVisited: string;
  visitCount: number;
  kioskSlug?: string;
  joinToken?: string;
}

function deriveBusinessesFromHistory(
  history: Array<{
    token: string;
    officeName: string;
    serviceName: string;
    date: string;
    officeId?: string;
    kioskSlug?: string;
  }>
): DerivedBusiness[] {
  const map = new Map<string, DerivedBusiness>();

  for (const entry of history) {
    const key = entry.officeId ?? entry.officeName;
    const existing = map.get(key);
    if (existing) {
      existing.visitCount += 1;
      if (entry.date > existing.lastVisited) {
        existing.lastVisited = entry.date;
        existing.lastService = entry.serviceName;
      }
      if (entry.kioskSlug && !existing.kioskSlug) existing.kioskSlug = entry.kioskSlug;
    } else {
      map.set(key, {
        id: key,
        name: entry.officeName,
        lastService: entry.serviceName,
        lastVisited: entry.date,
        visitCount: 1,
        kioskSlug: entry.kioskSlug,
      });
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.lastVisited).getTime() - new Date(a.lastVisited).getTime()
  );
}

// ---------------------------------------------------------------------------
// Business card component
// ---------------------------------------------------------------------------
function BusinessCard({
  name,
  subtitle,
  visitCount,
  lastVisited,
  isFavorited,
  onToggleFavorite,
  onPress,
  onJoin,
  onKiosk,
  colors,
  isDark,
}: {
  name: string;
  subtitle: string;
  visitCount: number;
  lastVisited?: string;
  isFavorited: boolean;
  onToggleFavorite: () => void;
  onPress: () => void;
  onJoin?: () => void;
  onKiosk?: () => void;
  colors: any;
  isDark: boolean;
}) {
  const dateStr = lastVisited
    ? new Date(lastVisited).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    <TouchableOpacity
      style={[styles.bizCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.bizCardTop}>
        <View style={[styles.bizIcon, { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.infoLight }]}>
          <Ionicons name="business-outline" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.bizName, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.bizSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <TouchableOpacity onPress={onToggleFavorite} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons
            name={isFavorited ? 'heart' : 'heart-outline'}
            size={22}
            color={isFavorited ? '#ef4444' : colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.bizMeta}>
        {dateStr && (
          <View style={styles.bizMetaItem}>
            <Ionicons name="time-outline" size={13} color={colors.textMuted} />
            <Text style={[styles.bizMetaText, { color: colors.textMuted }]}>{dateStr}</Text>
          </View>
        )}
        <View style={styles.bizMetaItem}>
          <Ionicons name="receipt-outline" size={13} color={colors.textMuted} />
          <Text style={[styles.bizMetaText, { color: colors.textMuted }]}>
            {visitCount} visit{visitCount !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      <View style={styles.bizActions}>
        {onKiosk && (
          <TouchableOpacity
            style={[styles.bizAction, { backgroundColor: colors.primary }]}
            onPress={onKiosk}
            activeOpacity={0.7}
          >
            <Ionicons name="tablet-portrait-outline" size={16} color="#fff" />
            <Text style={styles.bizActionTextWhite}>Kiosk</Text>
          </TouchableOpacity>
        )}
        {onJoin && (
          <TouchableOpacity
            style={[styles.bizAction, { backgroundColor: isDark ? 'rgba(59,130,246,0.15)' : colors.infoLight, borderWidth: 1, borderColor: colors.primary + '30' }]}
            onPress={onJoin}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
            <Text style={[styles.bizActionTextColor, { color: colors.primary }]}>Join Queue</Text>
          </TouchableOpacity>
        )}
        {!onKiosk && !onJoin && (
          <View style={[styles.bizActionPlaceholder, { borderColor: colors.border }]}>
            <Ionicons name="qr-code-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.bizActionPlaceholderText, { color: colors.textMuted }]}>
              Scan QR to connect
            </Text>
          </View>
        )}
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
  const { history, favorites, addFavorite, removeFavorite } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'favorites'>('all');

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const derivedBusinesses = useMemo(() => deriveBusinessesFromHistory(history), [history]);

  // Merge favorites with derived businesses
  const allBusinesses = useMemo(() => {
    const seen = new Set<string>();
    const merged: (DerivedBusiness & { isFavorited: boolean })[] = [];

    for (const fav of favorites) {
      seen.add(fav.id);
      const derived = derivedBusinesses.find((b) => b.id === fav.id);
      merged.push({
        id: fav.id,
        name: fav.name,
        lastService: derived?.lastService ?? '',
        lastVisited: fav.lastVisited ?? derived?.lastVisited ?? '',
        visitCount: derived?.visitCount ?? fav.visitCount,
        kioskSlug: fav.kioskSlug ?? derived?.kioskSlug,
        joinToken: fav.joinToken ?? derived?.joinToken,
        isFavorited: true,
      });
    }

    for (const biz of derivedBusinesses) {
      if (!seen.has(biz.id)) {
        seen.add(biz.id);
        merged.push({ ...biz, isFavorited: false });
      }
    }

    return merged;
  }, [favorites, derivedBusinesses]);

  const filtered = useMemo(() => {
    let items = tab === 'favorites' ? allBusinesses.filter((b) => b.isFavorited) : allBusinesses;
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((b) => b.name.toLowerCase().includes(q) || b.lastService.toLowerCase().includes(q));
    }
    return items;
  }, [allBusinesses, tab, search]);

  const handleToggleFavorite = (biz: (typeof allBusinesses)[0]) => {
    if (biz.isFavorited) {
      removeFavorite(biz.id);
    } else {
      addFavorite({
        id: biz.id,
        name: biz.name,
        kioskSlug: biz.kioskSlug,
        joinToken: biz.joinToken,
        lastVisited: biz.lastVisited,
      });
    }
  };

  const handleKiosk = (slug: string) => {
    router.push(`/kiosk/${slug}` as any);
  };

  const handleJoin = (token: string) => {
    router.push(`/join/${token}` as any);
  };

  const handleScan = () => {
    router.push('/scan' as any);
  };

  // =======================================================================
  // Empty state
  // =======================================================================
  if (allBusinesses.length === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.infoLight }]}>
          <Ionicons name="storefront-outline" size={56} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No places yet</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Businesses you visit will appear here. Scan a QR code to get started.
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
    >
      {/* Search bar */}
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search businesses..."
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

      {/* Tab switcher */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
        <TouchableOpacity
          style={[styles.tabItem, tab === 'all' && { backgroundColor: colors.primary + '15' }]}
          onPress={() => setTab('all')}
          activeOpacity={0.7}
        >
          <Ionicons name="storefront-outline" size={16} color={tab === 'all' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, { color: tab === 'all' ? colors.primary : colors.textMuted }]}>
            All ({allBusinesses.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, tab === 'favorites' && { backgroundColor: '#ef4444' + '15' }]}
          onPress={() => setTab('favorites')}
          activeOpacity={0.7}
        >
          <Ionicons name="heart" size={16} color={tab === 'favorites' ? '#ef4444' : colors.textMuted} />
          <Text style={[styles.tabText, { color: tab === 'favorites' ? '#ef4444' : colors.textMuted }]}>
            Favorites ({favorites.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Scan banner */}
      <TouchableOpacity
        style={[styles.scanBanner, { backgroundColor: isDark ? 'rgba(59,130,246,0.10)' : colors.infoLight, borderColor: colors.primary + '20' }]}
        onPress={handleScan}
        activeOpacity={0.7}
      >
        <View style={[styles.scanBannerIcon, { backgroundColor: colors.primary }]}>
          <Ionicons name="qr-code-outline" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.scanBannerTitle, { color: colors.text }]}>Add a new place</Text>
          <Text style={[styles.scanBannerSub, { color: colors.textSecondary }]}>Scan a QR code to join or save a business</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Business list */}
      {filtered.length === 0 ? (
        <View style={styles.noResults}>
          <Ionicons name="search-outline" size={32} color={colors.textMuted} />
          <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>
            {tab === 'favorites' ? 'No favorites yet. Tap the heart on any place to save it.' : 'No places match your search.'}
          </Text>
        </View>
      ) : (
        filtered.map((biz) => (
          <BusinessCard
            key={biz.id}
            name={biz.name}
            subtitle={biz.lastService || 'General'}
            visitCount={biz.visitCount}
            lastVisited={biz.lastVisited}
            isFavorited={biz.isFavorited}
            onToggleFavorite={() => handleToggleFavorite(biz)}
            onPress={() => {
              if (biz.kioskSlug) handleKiosk(biz.kioskSlug);
              else if (biz.joinToken) handleJoin(biz.joinToken);
              else handleScan();
            }}
            onKiosk={biz.kioskSlug ? () => handleKiosk(biz.kioskSlug!) : undefined}
            onJoin={biz.joinToken ? () => handleJoin(biz.joinToken!) : undefined}
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
    maxWidth: 280,
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

  tabBar: {
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  tabText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },

  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
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

  bizCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  bizCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  bizIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bizName: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  bizSub: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  bizMeta: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingLeft: 44 + spacing.md,
  },
  bizMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bizMetaText: {
    fontSize: fontSize.xs,
  },
  bizActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  bizAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
  },
  bizActionTextWhite: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: '#fff',
  },
  bizActionTextColor: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  bizActionPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  bizActionPlaceholderText: {
    fontSize: fontSize.xs,
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
