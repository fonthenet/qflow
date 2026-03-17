import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useOperatorStore } from '@/lib/operator-store';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

export default function OperatorSettingsScreen() {
  const router = useRouter();
  const { session, clearSession } = useOperatorStore();

  const handleSwitchDesk = () => {
    router.replace('/(auth)/role-select');
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          clearSession();
          router.replace('/(tabs)');
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Current Station */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Station</Text>
        <View style={styles.infoRow}>
          <Ionicons name="desktop-outline" size={20} color={colors.text} />
          <View>
            <Text style={styles.infoLabel}>Desk</Text>
            <Text style={styles.infoValue}>{session?.deskName ?? 'Not assigned'}</Text>
          </View>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={20} color={colors.text} />
          <View>
            <Text style={styles.infoLabel}>Office</Text>
            <Text style={styles.infoValue}>{session?.officeName ?? '—'}</Text>
          </View>
        </View>
        {session?.departmentName && (
          <View style={styles.infoRow}>
            <Ionicons name="git-branch-outline" size={20} color={colors.text} />
            <View>
              <Text style={styles.infoLabel}>Department</Text>
              <Text style={styles.infoValue}>{session.departmentName}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.actionRow} onPress={handleSwitchDesk}>
          <Ionicons name="swap-horizontal-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Switch Desk</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionRow} onPress={() => router.replace('/(tabs)')}>
          <Ionicons name="people-outline" size={22} color={colors.text} />
          <Text style={styles.actionText}>Customer View</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionRow} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color={colors.error} />
          <Text style={[styles.actionText, { color: colors.error }]}>Sign Out</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  infoLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  actionText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
});
