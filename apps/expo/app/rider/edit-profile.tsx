import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';
import { RiderAvatar } from '@/components/RiderAvatar';
import { C, F, R, SP } from '@/lib/rider-theme';

/**
 * Profile editor — currently just the display name. Avatar field is
 * already in the API contract; the picker UI is a follow-up commit
 * (needs expo-image-picker + a Supabase Storage bucket policy).
 *
 * On save we PATCH /api/rider/profile and refresh the auth context so
 * the home header updates immediately.
 */
export default function RiderEditProfileScreen() {
  const router = useRouter();
  const { rider, authedFetch, refresh } = useRiderAuth();
  const [name, setName] = useState(rider?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!rider) return null;

  const trimmed = name.trim();
  const dirty = trimmed !== rider.name;
  const valid = trimmed.length > 0 && trimmed.length <= 60;

  async function save() {
    if (!dirty || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await authedFetch('/api/rider/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data?.error ?? 'Could not save.');
        return;
      }
      await refresh();
      router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.title}>Edit profile</Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.avatarBlock}>
            <RiderAvatar name={trimmed || rider.name} url={rider.avatar_url} size={92} />
            <Text style={s.avatarHint}>Photo upload coming soon</Text>
          </View>

          <Text style={s.label}>Display name</Text>
          <TextInput
            value={name}
            onChangeText={(v) => { setName(v); setError(null); }}
            placeholder="Your name"
            placeholderTextColor={C.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={60}
            style={s.input}
            editable={!busy}
          />
          <Text style={s.helper}>This is how customers and operators see you.</Text>

          <Text style={[s.label, { marginTop: SP.lg }]}>WhatsApp number</Text>
          <View style={s.lockedRow}>
            <Text style={s.lockedValue}>{rider.phone}</Text>
            <Pressable
              onPress={() => router.push('/rider/change-phone' as any)}
              hitSlop={6}
              style={({ pressed }) => [s.changeBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.changeText}>Change</Text>
            </Pressable>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            onPress={save}
            disabled={!dirty || !valid || busy}
            style={({ pressed }) => [
              s.saveBtn,
              (!dirty || !valid || busy) && s.saveBtnDisabled,
              pressed && dirty && valid && !busy && { opacity: 0.85 },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

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

  scroll: { padding: SP.lg },

  avatarBlock: { alignItems: 'center', paddingVertical: SP.lg },
  avatarHint: { fontSize: F.sm, color: C.textFaint, marginTop: SP.md },

  label: { fontSize: F.sm, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: SP.sm },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderRadius: R.lg,
    paddingHorizontal: SP.lg, paddingVertical: SP.md,
    fontSize: F.lg, color: C.text,
  },
  helper: { fontSize: F.sm, color: C.textFaint, marginTop: SP.sm },

  lockedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderRadius: R.lg,
    paddingHorizontal: SP.lg, paddingVertical: SP.md,
  },
  lockedValue: { fontSize: F.lg, color: C.text, fontWeight: '600' },
  changeBtn: {
    paddingHorizontal: SP.md, paddingVertical: 6,
    borderRadius: R.full,
    backgroundColor: C.primaryTint,
  },
  changeText: { color: C.primaryDark, fontSize: F.sm, fontWeight: '700' },

  error: { color: C.danger, fontSize: F.base, marginTop: SP.md },

  saveBtn: {
    backgroundColor: C.primary,
    borderRadius: R.lg,
    paddingVertical: SP.lg,
    alignItems: 'center', justifyContent: 'center',
    marginTop: SP.xl,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontSize: F.lg, fontWeight: '700' },
});
