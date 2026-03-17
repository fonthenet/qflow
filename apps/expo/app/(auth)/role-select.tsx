import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useOperatorStore } from '@/lib/operator-store';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

interface StaffRecord {
  id: string;
  full_name: string;
  role: string;
  office_id: string | null;
  department_id: string | null;
  offices: { id: string; name: string } | null;
  departments: { id: string; name: string } | null;
}

interface DeskRecord {
  id: string;
  name: string;
  office_id: string;
  offices: { id: string; name: string } | null;
  departments: { id: string; name: string } | null;
}

interface StaffAssignment {
  staffId: string;
  staffName: string;
  deskId: string | null;
  deskName: string | null;
  officeId: string;
  officeName: string;
  departmentId: string | null;
  departmentName: string | null;
}

export default function RoleSelectScreen() {
  const router = useRouter();
  const { setSession } = useOperatorStore();
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAssignments();
  }, []);

  const loadAssignments = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get staff records for this user
    const { data: staffRows } = await supabase
      .from('staff')
      .select('id, full_name, role, office_id, department_id, offices:office_id(id, name), departments:department_id(id, name)')
      .eq('auth_user_id', user.id)
      .eq('is_active', true);

    if (!staffRows || staffRows.length === 0) {
      setLoading(false);
      return;
    }

    const results: StaffAssignment[] = [];

    for (const staff of staffRows as unknown as StaffRecord[]) {
      // Find desks assigned to this staff member
      const { data: desks } = await supabase
        .from('desks')
        .select('id, name, office_id, offices:office_id(id, name), departments:department_id(id, name)')
        .eq('current_staff_id', staff.id)
        .eq('is_active', true);

      if (desks && desks.length > 0) {
        for (const desk of desks as unknown as DeskRecord[]) {
          results.push({
            staffId: staff.id,
            staffName: staff.full_name,
            deskId: desk.id,
            deskName: desk.name,
            officeId: desk.offices?.id ?? staff.office_id ?? '',
            officeName: desk.offices?.name ?? staff.offices?.name ?? '',
            departmentId: desk.departments?.id ?? staff.department_id,
            departmentName: desk.departments?.name ?? staff.departments?.name ?? null,
          });
        }
      } else {
        // Staff with no desk — still show as option (admin role, etc.)
        results.push({
          staffId: staff.id,
          staffName: staff.full_name,
          deskId: null,
          deskName: null,
          officeId: staff.offices?.id ?? staff.office_id ?? '',
          officeName: staff.offices?.name ?? '',
          departmentId: staff.departments?.id ?? staff.department_id,
          departmentName: staff.departments?.name ?? null,
        });
      }
    }

    setAssignments(results);
    setLoading(false);
  };

  const handleSelect = (assignment: StaffAssignment) => {
    setSession({
      staffId: assignment.staffId,
      deskId: assignment.deskId,
      deskName: assignment.deskName,
      officeId: assignment.officeId,
      officeName: assignment.officeName,
      departmentId: assignment.departmentId,
      departmentName: assignment.departmentName,
    });
    router.replace('/(operator)/desk');
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (assignments.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.warning} />
        <Text style={styles.emptyTitle}>No assignments found</Text>
        <Text style={styles.emptySubtitle}>
          Contact your admin to get assigned to a desk
        </Text>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={async () => {
            await supabase.auth.signOut();
            router.replace('/(tabs)/profile');
          }}
        >
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={assignments}
      keyExtractor={(item, index) => `${item.staffId}-${item.deskId ?? index}`}
      ListHeaderComponent={
        <Text style={styles.header}>Select your station</Text>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleSelect(item)}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="desktop-outline" size={28} color={colors.primary} />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>
              {item.deskName ?? item.staffName}
            </Text>
            <Text style={styles.cardSubtitle}>
              {item.officeName}
              {item.departmentName ? ` · ${item.departmentName}` : ''}
              {!item.deskName ? ' · No desk' : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  logoutButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.error,
    marginTop: spacing.md,
  },
  logoutText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.error,
  },
  header: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.waitingBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContent: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
});
