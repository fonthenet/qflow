import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

interface DashboardStats {
  totalWaiting: number;
  totalServing: number;
  totalCalled: number;
  todayServed: number;
  todayNoShow: number;
  todayCancelled: number;
  todayTotal: number;
  activeDesks: number;
  totalDesks: number;
  avgWaitMinutes: number;
  avgServiceMinutes: number;
  completionRate: number;
  noShowRate: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState('');

  const loadStats = useCallback(async () => {
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
    setOrgName((staff as any).organizations?.name ?? '');

    const { data: offices } = await supabase
      .from('offices')
      .select('id')
      .eq('organization_id', orgId);

    const officeIds = offices?.map((o) => o.id) ?? [];
    if (officeIds.length === 0) {
      setStats({ totalWaiting: 0, totalServing: 0, totalCalled: 0, todayServed: 0, todayNoShow: 0, todayCancelled: 0, todayTotal: 0, activeDesks: 0, totalDesks: 0, avgWaitMinutes: 0, avgServiceMinutes: 0, completionRate: 0, noShowRate: 0 });
      setLoading(false);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const [waiting, serving, called, served, noShow, cancelled, desksActive, desksTotal, todayTickets] = await Promise.all([
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'waiting'),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'serving'),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'called'),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'served').gte('completed_at', todayISO),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'no_show').gte('completed_at', todayISO),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'cancelled').gte('created_at', todayISO),
      supabase.from('desks').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('is_active', true).eq('status', 'active'),
      supabase.from('desks').select('id', { count: 'exact', head: true }).in('office_id', officeIds),
      supabase.from('tickets').select('created_at, serving_started_at, completed_at, status').in('office_id', officeIds).gte('created_at', todayISO).in('status', ['served', 'no_show', 'cancelled']),
    ]);

    let totalWaitMs = 0, waitCount = 0, totalServiceMs = 0, serviceCount = 0;
    (todayTickets.data ?? []).forEach((t: any) => {
      if (t.serving_started_at && t.created_at) {
        totalWaitMs += new Date(t.serving_started_at).getTime() - new Date(t.created_at).getTime();
        waitCount++;
      }
      if (t.completed_at && t.serving_started_at && t.status === 'served') {
        totalServiceMs += new Date(t.completed_at).getTime() - new Date(t.serving_started_at).getTime();
        serviceCount++;
      }
    });

    const servedCount = served.count ?? 0;
    const noShowCount = noShow.count ?? 0;
    const cancelledCount = cancelled.count ?? 0;
    const totalCompleted = servedCount + noShowCount + cancelledCount;

    setStats({
      totalWaiting: waiting.count ?? 0,
      totalServing: serving.count ?? 0,
      totalCalled: called.count ?? 0,
      todayServed: servedCount,
      todayNoShow: noShowCount,
      todayCancelled: cancelledCount,
      todayTotal: totalCompleted,
      activeDesks: desksActive.count ?? 0,
      totalDesks: desksTotal.count ?? 0,
      avgWaitMinutes: waitCount > 0 ? Math.round(totalWaitMs / waitCount / 60000) : 0,
      avgServiceMinutes: serviceCount > 0 ? Math.round(totalServiceMs / serviceCount / 60000) : 0,
      completionRate: totalCompleted > 0 ? Math.round((servedCount / totalCompleted) * 100) : 0,
      noShowRate: totalCompleted > 0 ? Math.round((noShowCount / totalCompleted) * 100) : 0,
    });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, [loadStats]);

  // Navigate to queue tab with a specific filter (uses tab navigation)
  const goToQueue = () => router.push('/(admin)/queue');
  const goToManage = () => router.push('/(admin)/manage');

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={loadStats} tintColor="#fff" />}
    >
      <Text style={styles.orgName}>{orgName}</Text>

      {/* Live Stats — tappable */}
      <View style={styles.statsGrid}>
        <StatCard label="Waiting" value={stats?.totalWaiting ?? 0} color={colors.waiting} icon="time" onPress={goToQueue} />
        <StatCard label="Called" value={stats?.totalCalled ?? 0} color={colors.called} icon="megaphone" onPress={goToQueue} />
        <StatCard label="Serving" value={stats?.totalServing ?? 0} color={colors.serving} icon="pulse" onPress={goToQueue} />
        <StatCard label="Desks Active" value={`${stats?.activeDesks ?? 0}/${stats?.totalDesks ?? 0}`} color={colors.primary} icon="desktop" onPress={goToManage} />
      </View>

      {/* Today's Performance — tappable */}
      <Text style={styles.sectionTitle}>Today</Text>
      <View style={styles.statsGrid}>
        <StatCard label="Served" value={stats?.todayServed ?? 0} color={colors.success} icon="checkmark-circle" onPress={goToQueue} />
        <StatCard label="No Show" value={stats?.todayNoShow ?? 0} color={colors.warning} icon="alert-circle" onPress={goToQueue} />
        <StatCard label="Avg Wait" value={`${stats?.avgWaitMinutes ?? 0}m`} color={colors.called} icon="hourglass" />
        <StatCard label="Avg Service" value={`${stats?.avgServiceMinutes ?? 0}m`} color={colors.serving} icon="stopwatch" />
      </View>

      {/* Rates */}
      <Text style={styles.sectionTitle}>Performance</Text>
      <View style={styles.statsGrid}>
        <StatCard label="Completion" value={`${stats?.completionRate ?? 0}%`} color={colors.success} icon="trending-up" />
        <StatCard label="No-Show Rate" value={`${stats?.noShowRate ?? 0}%`} color={colors.warning} icon="trending-down" />
        <StatCard label="Cancelled" value={stats?.todayCancelled ?? 0} color={colors.error} icon="close-circle" onPress={goToQueue} />
        <StatCard label="Total Today" value={stats?.todayTotal ?? 0} color={colors.primary} icon="stats-chart" onPress={goToQueue} />
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        <ActionCard label="Live Queue" icon="list" onPress={goToQueue} />
        <ActionCard label="Staff & Desks" icon="people" onPress={goToManage} />
        <ActionCard label="Desk Panel" icon="desktop" onPress={() => router.push('/(operator)/desk')} />
        <ActionCard label="Customer View" icon="ticket" onPress={() => router.push('/(tabs)')} />
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value, color, icon, onPress }: { label: string; value: number | string; color: string; icon: string; onPress?: () => void }) {
  const content = (
    <>
      <Ionicons name={icon as any} size={22} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.statCard} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={styles.statCard}>{content}</View>;
}

function ActionCard({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionCard} onPress={onPress}>
      <Ionicons name={icon as any} size={24} color={colors.primary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  orgName: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  statValue: { fontSize: fontSize.xxl, fontWeight: '800' },
  statLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  actionCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  actionLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
});
