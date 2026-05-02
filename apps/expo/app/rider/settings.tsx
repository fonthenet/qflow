import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';
import { RiderAvatar } from '@/components/RiderAvatar';
import { C, F, R, SP } from '@/lib/rider-theme';

export default function RiderSettingsScreen() {
  const router = useRouter();
  const { rider, signOut, authedFetch } = useRiderAuth();
  if (!rider) return null;

  function confirmSignOut() {
    Alert.alert(
      'Sign out?',
      'You\'ll need your WhatsApp code to sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/rider/login' as any);
          },
        },
      ],
    );
  }

  // Self-serve "stop being a driver" — flips the rider record
  // inactive on the server, revokes every session, drops device
  // push tokens, then bounces back to the login screen. The
  // operator has to re-add the phone if the user ever wants back.
  function confirmLeaveDriver() {
    Alert.alert(
      'Stop being a driver?',
      'You\'ll be removed as a driver and signed out. The business will need to re-add your number to bring you back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop driving',
          style: 'destructive',
          onPress: async () => {
            try {
              const r = await authedFetch('/api/rider/leave', { method: 'POST' });
              if (!r.ok) {
                Alert.alert('Could not leave', 'Try again or contact the business.');
                return;
              }
            } catch {
              Alert.alert('Network error', 'Try again when you have connection.');
              return;
            }
            // Local sign-out — drops the cached session token
            // immediately so the next render boots login.
            await signOut();
            router.replace('/rider/login' as any);
          },
        },
      ],
    );
  }

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.title}>Settings</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Profile card */}
        <Pressable
          onPress={() => router.push('/rider/edit-profile' as any)}
          style={({ pressed }) => [s.profileCard, pressed && { backgroundColor: C.surface2 }]}
        >
          <RiderAvatar name={rider.name} url={rider.avatar_url} size={64} />
          <View style={{ flex: 1, marginLeft: SP.lg }}>
            <Text style={s.profileName}>{rider.name}</Text>
            <Text style={s.profilePhone}>{rider.phone}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={C.textFaint} />
        </Pressable>

        <SectionLabel>Account</SectionLabel>
        <View style={s.group}>
          <Row
            icon="person-outline"
            label="Edit profile"
            onPress={() => router.push('/rider/edit-profile' as any)}
          />
          <Divider />
          <Row
            icon="call-outline"
            label="Change WhatsApp number"
            onPress={() => router.push('/rider/change-phone' as any)}
          />
        </View>

        <SectionLabel>Activity</SectionLabel>
        <View style={s.group}>
          <Row
            icon="time-outline"
            label="Delivery history"
            onPress={() => router.push('/rider/history' as any)}
          />
        </View>

        <SectionLabel>About</SectionLabel>
        <View style={s.group}>
          <Row
            icon="shield-checkmark-outline"
            label="Privacy"
            onPress={() => {}}
            disabled
          />
          <Divider />
          <Row
            icon="document-text-outline"
            label="Terms of service"
            onPress={() => {}}
            disabled
          />
        </View>

        <Pressable
          onPress={confirmSignOut}
          style={({ pressed }) => [s.signOut, pressed && { backgroundColor: C.dangerTint }]}
        >
          <Ionicons name="log-out-outline" size={20} color={C.danger} />
          <Text style={s.signOutText}>Sign out</Text>
        </Pressable>

        {/* Stop being a driver — destructive, distinct from sign-out
            (sign-out leaves the rider record active). Spaced down a
            bit so it doesn't look like a peer of sign-out. */}
        <Pressable
          onPress={confirmLeaveDriver}
          style={({ pressed }) => [
            s.signOut,
            { marginTop: SP.md, borderColor: C.danger },
            pressed && { backgroundColor: C.dangerTint },
          ]}
        >
          <Ionicons name="close-circle-outline" size={20} color={C.danger} />
          <Text style={s.signOutText}>Stop being a driver</Text>
        </Pressable>

        <Text style={s.version}>Qflo Rider</Text>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

function Row({ icon, label, onPress, disabled }: { icon: any; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.row, pressed && !disabled && { backgroundColor: C.surface2 }]}
    >
      <Ionicons name={icon} size={20} color={disabled ? C.textFaint : C.text} />
      <Text style={[s.rowLabel, disabled && { color: C.textFaint }]}>{label}</Text>
      {!disabled ? <Ionicons name="chevron-forward" size={18} color={C.textFaint} /> : null}
    </Pressable>
  );
}

function Divider() { return <View style={s.divider} />; }

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingTop: 56, paddingBottom: SP.md,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  back: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: F.lg, fontWeight: '700', color: C.text },

  scroll: { padding: SP.lg, paddingBottom: SP.xxl },

  profileCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface,
    padding: SP.lg, borderRadius: R.lg,
    borderWidth: 1, borderColor: C.border,
  },
  profileName: { fontSize: F.xl, fontWeight: '800', color: C.text },
  profilePhone: { fontSize: F.md, color: C.textMuted, marginTop: 2 },

  sectionLabel: {
    fontSize: F.sm, fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: SP.xl, marginBottom: SP.sm, marginLeft: SP.xs,
  },
  group: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    borderWidth: 1, borderColor: C.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
    paddingHorizontal: SP.lg, paddingVertical: SP.md,
  },
  rowLabel: { flex: 1, fontSize: F.lg, color: C.text, fontWeight: '600' },
  divider: { height: 1, backgroundColor: C.border, marginLeft: SP.xxl + 12 },

  signOut: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    backgroundColor: C.surface,
    paddingVertical: SP.lg,
    borderRadius: R.lg,
    borderWidth: 1, borderColor: C.border,
    marginTop: SP.xl,
  },
  signOutText: { color: C.danger, fontSize: F.lg, fontWeight: '700' },

  version: { textAlign: 'center', fontSize: F.sm, color: C.textFaint, marginTop: SP.lg },
});
