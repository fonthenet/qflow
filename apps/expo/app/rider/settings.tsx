import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';

export default function RiderSettingsScreen() {
  const router = useRouter();
  const { rider, signOut } = useRiderAuth();
  if (!rider) return null;

  return (
    <View style={s.root}>
      <Stack.Screen options={{ title: 'Settings', headerShown: false }} />
      <View style={s.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={22} color="#475569" />
          <Text style={s.backText}>Back</Text>
        </Pressable>
        <Text style={s.title}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.section}>Account</Text>
        <View style={s.card}>
          <View style={s.kv}>
            <Text style={s.k}>Name</Text>
            <Text style={s.v}>{rider.name}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.kv}>
            <Text style={s.k}>WhatsApp number</Text>
            <Text style={s.v}>{rider.phone}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/rider/change-phone' as any)}
          style={({ pressed }) => [s.row, pressed && { backgroundColor: '#f1f5f9' }]}
        >
          <Ionicons name="call-outline" size={20} color="#475569" />
          <Text style={s.rowLabel}>Change phone number</Text>
          <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
        </Pressable>

        <Pressable
          onPress={async () => {
            await signOut();
            router.replace('/rider/login' as any);
          }}
          style={({ pressed }) => [s.row, pressed && { backgroundColor: '#fee2e2' }]}
        >
          <Ionicons name="log-out-outline" size={20} color="#dc2626" />
          <Text style={[s.rowLabel, { color: '#dc2626' }]}>Sign out</Text>
          <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  topbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 56, paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  back: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 4 },
  backText: { color: '#475569', fontSize: 15, marginLeft: 2 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  scroll: { padding: 16 },
  section: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginLeft: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16,
  },
  kv: { paddingHorizontal: 16, paddingVertical: 14 },
  k: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  v: { fontSize: 15, color: '#0f172a', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#e2e8f0' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 16,
    borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  rowLabel: { flex: 1, fontSize: 15, color: '#0f172a', fontWeight: '600' },
});
