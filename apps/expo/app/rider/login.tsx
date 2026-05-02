import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';
import { C, F, R, SP } from '@/lib/rider-theme';

/**
 * Rider login — phone entry. Server quietly succeeds for unknown
 * phones (anti-enumeration), so we always advance to the verify
 * screen on submit. The verify step gives the real "wrong code"
 * feedback.
 */
export default function RiderLoginScreen() {
  const router = useRouter();
  const { startLogin } = useRiderAuth();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^\+?\d{6,20}$/.test(phone.trim());

  async function onSubmit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const r = await startLogin(phone.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Could not send code.');
      return;
    }
    router.push({ pathname: '/rider/verify' as any, params: { phone: phone.trim() } });
  }

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.brand}>
            <View style={s.logoMark}>
              <MaterialCommunityIcons name="moped" size={44} color="#fff" />
            </View>
            <Text style={s.brandName}>Qflo Rider</Text>
            <Text style={s.brandTag}>Deliver smarter</Text>
          </View>

          <View style={s.card}>
            <Text style={s.title}>Sign in</Text>
            <Text style={s.subtitle}>
              Enter the WhatsApp number registered with your business. We'll
              send a 6-digit code.
            </Text>

            <Text style={s.label}>WhatsApp number</Text>
            <TextInput
              value={phone}
              onChangeText={(v) => { setPhone(v); setError(null); }}
              placeholder="+213 …"
              placeholderTextColor={C.textFaint}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="tel"
              style={s.input}
              editable={!busy}
              onSubmitEditing={onSubmit}
            />
            {error ? <Text style={s.error}>{error}</Text> : null}

            <Pressable
              onPress={onSubmit}
              disabled={!valid || busy}
              style={({ pressed }) => [
                s.btn,
                (!valid || busy) && s.btnDisabled,
                pressed && valid && !busy && { opacity: 0.85 },
              ]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send code</Text>}
            </Pressable>
          </View>

          <View style={s.footer}>
            <Ionicons name="logo-whatsapp" size={16} color={C.success} />
            <Text style={s.footerText}>The code arrives on WhatsApp.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, padding: SP.lg, paddingTop: SP.xxl + SP.lg },

  brand: { alignItems: 'center', marginBottom: SP.xxl },
  logoMark: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.md,
  },
  brandName: { fontSize: F.hero, fontWeight: '800', color: C.text },
  brandTag: { fontSize: F.md, color: C.textMuted, marginTop: 4 },

  card: {
    backgroundColor: C.surface,
    borderRadius: R.xl,
    padding: SP.xl,
    borderWidth: 1, borderColor: C.border,
  },
  title: { fontSize: F.xxl, fontWeight: '800', color: C.text, marginBottom: SP.xs },
  subtitle: { fontSize: F.md, color: C.textMuted, marginBottom: SP.lg, lineHeight: 21 },
  label: { fontSize: F.sm, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: SP.sm },
  input: {
    backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border, borderRadius: R.lg,
    paddingHorizontal: SP.lg, paddingVertical: SP.md,
    fontSize: F.xl, color: C.text,
  },
  error: { color: C.danger, fontSize: F.base, marginTop: SP.sm },
  btn: {
    backgroundColor: C.primary,
    paddingVertical: SP.lg,
    borderRadius: R.lg,
    alignItems: 'center',
    marginTop: SP.lg,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: F.lg, fontWeight: '700' },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: SP.xl },
  footerText: { fontSize: F.sm, color: C.textMuted },
});
