import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';

/**
 * Rider home — auth gate + landing. Logged out → push to /rider/login.
 * Logged in → render the home shell. Active deliveries list + history
 * + online toggle land in follow-up commits; for now this is the
 * minimal "you're signed in" surface plus settings entry points.
 */
export default function RiderHomeScreen() {
  const router = useRouter();
  const { ready, rider, signOut } = useRiderAuth();

  useEffect(() => {
    if (ready && !rider) {
      router.replace('/rider/login' as any);
    }
  }, [ready, rider, router]);

  if (!ready || !rider) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#1d4ed8" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Stack.Screen options={{ title: 'Rider', headerShown: false }} />
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.header}>
          <View style={s.avatar}>
            <Ionicons name="bicycle" size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{rider.name}</Text>
            <Text style={s.phone}>{rider.phone}</Text>
          </View>
        </View>

        <View style={s.banner}>
          <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
          <Text style={s.bannerText}>
            You're signed in. New assignments will arrive here and on WhatsApp.
          </Text>
        </View>

        {/* Placeholder rows — active deliveries + history land in
            the next commits (they need their own endpoints + lists). */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Active deliveries</Text>
          <Text style={s.cardSubtitle}>None right now.</Text>
        </View>

        <Row
          icon="time"
          label="Delivery history"
          onPress={() => router.push('/rider/history' as any)}
        />
        <Row
          icon="settings-outline"
          label="Settings"
          onPress={() => router.push('/rider/settings' as any)}
        />
        <Row
          icon="log-out-outline"
          label="Sign out"
          tint="#dc2626"
          onPress={async () => {
            await signOut();
            router.replace('/rider/login' as any);
          }}
        />
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, tint, onPress }: { icon: any; label: string; tint?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: '#f1f5f9' }]}
    >
      <Ionicons name={icon} size={22} color={tint ?? '#475569'} />
      <Text style={[s.rowLabel, tint ? { color: tint } : null]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingTop: 56 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#1d4ed8',
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  phone: { fontSize: 13, color: '#64748b', marginTop: 2 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#dcfce7',
    padding: 14, borderRadius: 12,
    marginBottom: 20,
  },
  bannerText: { flex: 1, fontSize: 13, color: '#166534', lineHeight: 18 },
  card: {
    backgroundColor: '#fff',
    padding: 16, borderRadius: 12,
    borderWidth: 1, borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  cardSubtitle: { fontSize: 13, color: '#94a3b8', marginTop: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 16,
    borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  rowLabel: { flex: 1, fontSize: 15, color: '#0f172a', fontWeight: '600' },
});
