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
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useOperatorStore } from '@/lib/operator-store';
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
  todayBookings: number;
  pendingBookings: number;
}

interface DeptQueue {
  id: string;
  name: string;
  code: string;
  waiting: number;
  serving: number;
  called: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { session: operatorSession } = useOperatorStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [deptQueues, setDeptQueues] = useState<DeptQueue[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState('');
  const [staffName, setStaffName] = useState('');

  const loadStats = useCallback(async () => {
    if (!user) return;

    const { data: staff } = await supabase
      .from('staff')
      .select('organization_id, full_name, organizations:organization_id(name)')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!staff) return;
    const orgId = staff.organization_id;
    setOrgName((staff as any).organizations?.name ?? '');
    setStaffName(staff.full_name ?? '');

    const { data: offices } = await supabase
      .from('offices')
      .select('id')
      .eq('organization_id', orgId);

    const officeIds = offices?.map((o) => o.id) ?? [];
    if (officeIds.length === 0) {
      setStats({
        totalWaiting: 0, totalServing: 0, totalCalled: 0,
        todayServed: 0, todayNoShow: 0, todayCancelled: 0, todayTotal: 0,
        activeDesks: 0, totalDesks: 0,
        avgWaitMinutes: 0, avgServiceMinutes: 0,
        completionRate: 0, noShowRate: 0,
        todayBookings: 0, pendingBookings: 0,
      });
      setLoading(false);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();
    const todayDate = today.toISOString().split('T')[0];

    const [
      waiting, serving, called, served, noShow, cancelled,
      desksActive, desksTotal, todayTickets,
      departments, deptTickets,
      bookingsToday, bookingsPending,
    ] = await Promise.all([
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'waiting'),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'serving'),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'called'),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'served').gte('completed_at', todayISO),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'no_show').gte('completed_at', todayISO),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'cancelled').gte('created_at', todayISO),
      supabase.from('desks').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('is_active', true).eq('status', 'open'),
      supabase.from('desks').select('id', { count: 'exact', head: true }).in('office_id', officeIds),
      supabase.from('tickets').select('created_at, serving_started_at, completed_at, status').in('office_id', officeIds).gte('created_at', todayISO).in('status', ['served', 'no_show', 'cancelled']),
      // Departments
      supabase.from('departments').select('id, name, code').in('office_id', officeIds).eq('is_active', true),
      // Active tickets per department
      supabase.from('tickets').select('department_id, status').in('office_id', officeIds).in('status', ['waiting', 'called', 'serving']),
      // Bookings
      supabase.from('appointments').select('id', { count: 'exact', head: true }).in('office_id', officeIds).gte('scheduled_at', todayDate + 'T00:00:00').lt('scheduled_at', todayDate + 'T23:59:59').neq('status', 'cancelled'),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'pending'),
    ]);

    // Build dept queue breakdown
    const deptMap = new Map<string, DeptQueue>();
    (departments.data ?? []).forEach((d: any) => {
      deptMap.set(d.id, { id: d.id, name: d.name, code: d.code, waiting: 0, serving: 0, called: 0 });
    });
    (deptTickets.data ?? []).forEach((t: any) => {
      const dept = deptMap.get(t.department_id);
      if (dept) {
        if (t.status === 'waiting') dept.waiting++;
        else if (t.status === 'called') dept.called++;
        else if (t.status === 'serving') dept.serving++;
      }
    });
    setDeptQueues(Array.from(deptMap.values()).filter(d => d.waiting + d.called + d.serving > 0));

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
      todayBookings: bookingsToday.count ?? 0,
      pendingBookings: bookingsPending.count ?? 0,
    });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, [loadStats]);

  const goToQueue = () => router.navigate('/(admin)/queue');
  const goToManage = () => router.navigate('/(admin)/manage');

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return t('admin.goodMorning');
    if (h < 17) return t('admin.goodAfternoon');
    return t('admin.goodEvening');
  };

  if (loading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const liveTotal = (stats?.totalWaiting ?? 0) + (stats?.totalCalled ?? 0) + (stats?.totalServing ?? 0);

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={loadStats} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>{greeting()},</Text>
          <Text style={s.staffName}>{staffName || 'Admin'}</Text>
        </View>
        <View style={s.orgBadge}>
          <Ionicons name="business-outline" size={14} color={colors.primary} />
          <Text style={s.orgName}>{orgName}</Text>
        </View>
      </View>

      {/* Live Status Banner */}
      <View style={s.liveBanner}>
        <TouchableOpacity onPress={goToQueue} activeOpacity={0.8}>
          <View style={s.liveRow}>
            <View style={s.liveDot} />
            <Text style={s.liveLabel}>{t('admin.liveQueue')}</Text>
            <Text style={s.liveCount}>{t('admin.customer', { count: liveTotal })}</Text>
          </View>
          <View style={s.liveStats}>
            <LivePill label={t('status.waiting')} count={stats?.totalWaiting ?? 0} color={colors.waiting} bg={colors.waitingBg} />
            <LivePill label={t('status.called')} count={stats?.totalCalled ?? 0} color={colors.called} bg={colors.calledBg} />
            <LivePill label={t('status.serving')} count={stats?.totalServing ?? 0} color={colors.serving} bg={colors.servingBg} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.startServingBtn}
          onPress={() => router.navigate(operatorSession?.deskId ? '/(operator)/desk' : '/(auth)/role-select')}
          activeOpacity={0.8}
        >
          <Ionicons name="desktop-outline" size={18} color="#fff" />
          <Text style={s.startServingText}>
            {operatorSession?.deskId ? t('admin.goToDesk') : t('admin.startServing')}
          </Text>
          <Ionicons name="arrow-forward" size={16} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      </View>

      {/* Department Breakdown — only if there are active tickets */}
      {deptQueues.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t('admin.byDepartment')}</Text>
          {deptQueues.map((d) => (
            <View key={d.id} style={s.deptRow}>
              <View style={s.deptInfo}>
                <View style={[s.deptCode, { backgroundColor: colors.waitingBg }]}>
                  <Text style={[s.deptCodeText, { color: colors.waiting }]}>{d.code}</Text>
                </View>
                <Text style={s.deptName} numberOfLines={1}>{d.name}</Text>
              </View>
              <View style={s.deptCounts}>
                {d.waiting > 0 && <MiniCount value={d.waiting} color={colors.waiting} />}
                {d.called > 0 && <MiniCount value={d.called} color={colors.called} />}
                {d.serving > 0 && <MiniCount value={d.serving} color={colors.serving} />}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Today's Summary */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>{t('admin.todaySummary')}</Text>
        <View style={s.metricsGrid}>
          <MetricCard
            icon="checkmark-circle"
            label={t('status.served')}
            value={stats?.todayServed ?? 0}
            color={colors.success}
            bg={colors.successLight}
          />
          <MetricCard
            icon="alert-circle"
            label={t('status.noShow')}
            value={stats?.todayNoShow ?? 0}
            color={colors.warning}
            bg={colors.warningLight}
          />
          <MetricCard
            icon="close-circle"
            label={t('status.cancelled')}
            value={stats?.todayCancelled ?? 0}
            color={colors.error}
            bg={colors.errorLight}
          />
          <MetricCard
            icon="calendar"
            label={t('admin.bookings')}
            value={stats?.todayBookings ?? 0}
            sub={stats?.pendingBookings ? `${stats.pendingBookings} ${t('admin.pending')}` : undefined}
            color={colors.info}
            bg={colors.infoLight}
          />
        </View>
      </View>

      {/* Performance */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>{t('admin.performance')}</Text>
        <View style={s.perfRow}>
          <PerfBar label={t('admin.avgWait')} value={`${stats?.avgWaitMinutes ?? 0}m`} icon="hourglass" />
          <PerfBar label={t('admin.avgService')} value={`${stats?.avgServiceMinutes ?? 0}m`} icon="stopwatch" />
          <PerfBar label={t('admin.completion')} value={`${stats?.completionRate ?? 0}%`} icon="trending-up" />
        </View>
      </View>

      {/* Desks */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>{t('admin.desks')}</Text>
        <View style={s.deskBar}>
          <View style={s.deskInfo}>
            <Text style={s.deskValue}>{stats?.activeDesks ?? 0}</Text>
            <Text style={s.deskLabel}>{t('common.open')}</Text>
          </View>
          <View style={s.deskSep} />
          <View style={s.deskInfo}>
            <Text style={[s.deskValue, { color: colors.textMuted }]}>{(stats?.totalDesks ?? 0) - (stats?.activeDesks ?? 0)}</Text>
            <Text style={s.deskLabel}>{t('common.closed')}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={s.deskAction} onPress={goToManage}>
            <Ionicons name="settings-outline" size={16} color={colors.primary} />
            <Text style={s.deskActionText}>{t('admin.manage')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>{t('admin.quickActions')}</Text>
        <View style={s.actionsGrid}>
          <ActionBtn icon="list" label={t('admin.liveQueueAction')} onPress={goToQueue} />
          <ActionBtn icon="calendar-outline" label={t('admin.bookings')} onPress={() => router.push('/admin/bookings')} />
          <ActionBtn icon="people-outline" label={t('admin.manageAction')} onPress={goToManage} />
          <ActionBtn icon="qr-code-outline" label={t('admin.qrLinks')} onPress={() => router.push('/admin/virtual-codes')} />
          <ActionBtn icon="add-circle-outline" label={t('admin.newTicket')} onPress={() => router.navigate('/(operator)/booking')} />
        </View>
      </View>
    </ScrollView>
  );
}

/* ── Sub Components ── */

function LivePill({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <View style={[s.livePill, { backgroundColor: bg }]}>
      <Text style={[s.livePillCount, { color }]}>{count}</Text>
      <Text style={[s.livePillLabel, { color }]}>{label}</Text>
    </View>
  );
}

function MiniCount({ value, color }: { value: number; color: string }) {
  return (
    <View style={[s.miniCount, { backgroundColor: color + '18' }]}>
      <Text style={[s.miniCountText, { color }]}>{value}</Text>
    </View>
  );
}

function MetricCard({ icon, label, value, color, bg, sub }: {
  icon: string; label: string; value: number; color: string; bg: string; sub?: string;
}) {
  return (
    <View style={[s.metricCard, { backgroundColor: bg }]}>
      <View style={s.metricTop}>
        <Ionicons name={icon as any} size={20} color={color} />
        <Text style={[s.metricValue, { color }]}>{value}</Text>
      </View>
      <Text style={[s.metricLabel, { color }]}>{label}</Text>
      {sub && <Text style={[s.metricSub, { color: color + 'aa' }]}>{sub}</Text>}
    </View>
  );
}

function PerfBar({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <View style={s.perfItem}>
      <Ionicons name={icon as any} size={18} color={colors.textSecondary} />
      <Text style={s.perfValue}>{value}</Text>
      <Text style={s.perfLabel}>{label}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.actionBtn} onPress={onPress} activeOpacity={0.7}>
      <View style={s.actionIcon}>
        <Ionicons name={icon as any} size={22} color={colors.primary} />
      </View>
      <Text style={s.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ── Styles ── */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl + 20, gap: spacing.lg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greeting: { fontSize: fontSize.sm, color: colors.textSecondary },
  staffName: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text, marginTop: 2 },
  orgBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.waitingBg, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  orgName: { fontSize: fontSize.xs, fontWeight: '600', color: colors.primary },

  // Live Banner
  liveBanner: {
    backgroundColor: colors.surface, borderRadius: borderRadius.xl,
    padding: spacing.lg, gap: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  liveLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1 },
  liveCount: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text, marginLeft: 'auto' },
  liveStats: { flexDirection: 'row', gap: spacing.sm },
  startServingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: colors.primary, paddingVertical: 12,
    borderRadius: borderRadius.lg, marginTop: 4,
  },
  startServingText: { fontSize: fontSize.sm, fontWeight: '700', color: '#fff' },
  livePill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: borderRadius.md,
  },
  livePillCount: { fontSize: fontSize.lg, fontWeight: '800' },
  livePillLabel: { fontSize: fontSize.xs, fontWeight: '600', opacity: 0.8 },

  // Section
  section: { gap: spacing.sm },
  sectionTitle: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4,
  },

  // Dept rows
  deptRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: borderRadius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  deptInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  deptCode: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: borderRadius.sm },
  deptCodeText: { fontSize: fontSize.xs, fontWeight: '700' },
  deptName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text, flex: 1 },
  deptCounts: { flexDirection: 'row', gap: 6 },
  miniCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.full, minWidth: 28, alignItems: 'center' },
  miniCountText: { fontSize: fontSize.xs, fontWeight: '700' },

  // Metrics
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metricCard: {
    flex: 1, minWidth: '46%', borderRadius: borderRadius.lg,
    padding: spacing.md, gap: 4,
  },
  metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricValue: { fontSize: fontSize.xxl, fontWeight: '800' },
  metricLabel: { fontSize: fontSize.xs, fontWeight: '600', opacity: 0.8 },
  metricSub: { fontSize: fontSize.xs, fontWeight: '500' },

  // Perf
  perfRow: {
    flexDirection: 'row', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: borderRadius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  perfItem: { flex: 1, alignItems: 'center', gap: 4 },
  perfValue: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  perfLabel: { fontSize: fontSize.xs, fontWeight: '500', color: colors.textMuted },

  // Desk bar
  deskBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
    backgroundColor: colors.surface, borderRadius: borderRadius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  deskInfo: { alignItems: 'center' },
  deskValue: { fontSize: fontSize.xl, fontWeight: '800', color: colors.success },
  deskLabel: { fontSize: fontSize.xs, fontWeight: '500', color: colors.textMuted },
  deskSep: { width: 1, height: 30, backgroundColor: colors.border },
  deskAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.waitingBg, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: borderRadius.full,
  },
  deskActionText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },

  // Actions
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionBtn: {
    width: '31%', alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  actionIcon: {
    width: 48, height: 48, borderRadius: borderRadius.lg,
    backgroundColor: colors.waitingBg, justifyContent: 'center', alignItems: 'center',
  },
  actionLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.text, textAlign: 'center' },
});
