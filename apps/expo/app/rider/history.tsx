import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/**
 * Delivery history — placeholder until /api/rider/history lands.
 * Auth backbone is in; the list query is the next commit.
 */
export default function RiderHistoryScreen() {
  const router = useRouter();
  return (
    <View style={s.root}>
      <Stack.Screen options={{ title: 'History', headerShown: false }} />
      <View style={s.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={22} color="#475569" />
          <Text style={s.backText}>Back</Text>
        </Pressable>
        <Text style={s.title}>Delivery history</Text>
        <View style={{ width: 60 }} />
      </View>
      <View style={s.empty}>
        <Ionicons name="time-outline" size={48} color="#cbd5e1" />
        <Text style={s.emptyText}>Your past deliveries will appear here.</Text>
      </View>
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyText: { fontSize: 14, color: '#94a3b8', textAlign: 'center' },
});
