import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useOperatorStore } from '@/lib/operator-store';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

interface OrgInfo {
  name: string;
  officeCount: number;
  staffCount: number;
  deskCount: number;
}

export default function MoreScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, signOut, staffRole } = useAuth();
  const { clearSession } = useOperatorStore();
  const [org, setOrg] = useState<OrgInfo | null>(null);

  useEffect(() => {
    loadOrg();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadOrg = async () => {
    if (!user) return;
    const { data: staff } = await supabase
      .from('staff')
      .select('organization_id, organizations:organization_id(name)')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!staff) return;
    const orgId = staff.organization_id;
    const orgName = (staff as any).organizations?.name ?? '';

    const { data: officeRows } = await supabase.from('offices').select('id').eq('organization_id', orgId);
    const officeIds = officeRows?.map(o => o.id) ?? [];

    const [offices, staffCount, desks] = await Promise.all([
      supabase.from('offices').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      supabase.from('staff').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
      officeIds.length > 0
        ? supabase.from('desks').select('id', { count: 'exact', head: true }).in('office_id', officeIds)
        : Promise.resolve({ count: 0 }),
    ]);

    setOrg({
      name: orgName,
      officeCount: offices.count ?? 0,
      staffCount: staffCount.count ?? 0,
      deskCount: desks.count ?? 0,
    });
  };

  const handleSignOut = () => {
    Alert.alert(t('auth.signOut'), t('adminMore.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: async () => {
          clearSession();
          await signOut();
          router.replace('/(tabs)');
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {/* ── Quick Actions ── */}
      <View style={styles.quickActions}>
        <View style={styles.quickActionRow}>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(admin)/manage')}
          >
            <Ionicons name="settings-outline" size={22} color={colors.primary} />
            <Text style={styles.quickActionCardLabel}>{t('adminMore.manage')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(tabs)')}
          >
            <Ionicons name="people-outline" size={22} color={colors.primary} />
            <Text style={styles.quickActionCardLabel}>{t('adminMore.customerView')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/admin/bookings')}
          >
            <Ionicons name="calendar-outline" size={22} color={colors.waiting} />
            <Text style={styles.quickActionCardLabel}>{t('adminMore.bookings')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/admin/virtual-codes')}
          >
            <Ionicons name="qr-code-outline" size={22} color={colors.success} />
            <Text style={styles.quickActionCardLabel}>{t('adminMore.qrCodes')}</Text>
          </TouchableOpacity>

          {staffRole && ['admin', 'manager', 'branch_admin'].includes(staffRole) && (
            <TouchableOpacity
              style={styles.quickActionCard}
              onPress={() => router.push('/(admin)/team')}
            >
              <Ionicons name="people-circle-outline" size={22} color={colors.primary} />
              <Text style={styles.quickActionCardLabel}>{t('team.title')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Account & Org ── */}
      <View style={styles.section}>
        <View style={styles.accountHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user?.email ?? '?')[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.accountEmail}>{user?.email ?? '—'}</Text>
            <Text style={styles.accountOrg}>{org?.name ?? '—'}</Text>
          </View>
          {staffRole && (
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{staffRole.replace(/_/g, ' ')}</Text>
            </View>
          )}
        </View>

        {org && (
          <View style={styles.statsRow}>
            <StatItem icon="location" label={t('adminMore.offices')} value={org.officeCount} />
            <StatItem icon="people" label={t('adminMore.staffCount')} value={org.staffCount} />
            <StatItem icon="desktop" label={t('adminMore.desksCount')} value={org.deskCount} />
          </View>
        )}
      </View>


      {/* ── Sign Out ── */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.signOutText}>{t('auth.signOut')}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Qflo v1.0.0</Text>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ── Sub-components ── */

function StatItem({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon as any} size={18} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/* ── Styles ── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 100 },

  // Quick Actions
  quickActions: { gap: spacing.sm },
  quickActionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  quickActionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActionTitle: { fontSize: fontSize.lg, fontWeight: '700', color: '#fff' },
  quickActionSub: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  quickActionRow: { flexDirection: 'row', gap: spacing.sm },
  quickActionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickActionCardLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.text, textAlign: 'center' },

  // Account
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: '700', color: '#fff' },
  accountEmail: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  accountOrg: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  roleBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  roleBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: '#fff', textTransform: 'capitalize' },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted },

  // Collapsible
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapsibleLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  collapsibleBody: { marginTop: spacing.md, gap: spacing.md },

  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },

  // Settings
  settingRow: { gap: spacing.xs },
  settingLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  settingLabelText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
  },

  // Sign out
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.error + '30',
  },
  signOutText: { fontSize: fontSize.md, fontWeight: '600', color: colors.error },
  version: { textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },

  // Timezone
  tzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  tzOfficeName: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  tzValue: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  tzChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '12',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: borderRadius.md,
  },
  tzChangeBtnText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  tzModal: { flex: 1, backgroundColor: colors.background },
  tzModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tzModalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  tzSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: spacing.md,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tzSearchInput: { flex: 1, paddingVertical: 10, fontSize: fontSize.md, color: colors.text },
  tzOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  tzOptionSelected: { backgroundColor: colors.primary + '10' },
  tzOptionText: { fontSize: fontSize.md, color: colors.text },
  tzOptionTextSelected: { fontWeight: '700', color: colors.primary },
});
