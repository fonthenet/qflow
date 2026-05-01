import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';

/**
 * Rider login — phone entry. Server quietly succeeds for unknown
 * phones (anti-enumeration), so we always advance to the verify
 * screen on submit. The verify step gives the real "wrong code" /
 * "no account" feedback.
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
      <Stack.Screen options={{ title: 'Rider sign in' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.iconBubble}>
            <Ionicons name="bicycle" size={36} color="#fff" />
          </View>
          <Text style={s.title}>Rider sign in</Text>
          <Text style={s.subtitle}>
            Enter your WhatsApp number. We'll send you a 6-digit code.
          </Text>

          <Text style={s.label}>WhatsApp number</Text>
          <TextInput
            value={phone}
            onChangeText={(v) => { setPhone(v); setError(null); }}
            placeholder="+213 …"
            placeholderTextColor="#94a3b8"
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
              pressed && valid && !busy && s.btnPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.btnText}>Send code</Text>
            )}
          </Pressable>

          <Text style={s.hint}>
            Your number must already be registered with the business that
            assigns your deliveries.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 60, alignItems: 'center' },
  iconBubble: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#1d4ed8',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#64748b', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  label: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  input: {
    width: '100%', backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 17, color: '#0f172a',
  },
  error: { alignSelf: 'flex-start', color: '#dc2626', fontSize: 13, marginTop: 8 },
  btn: {
    width: '100%', backgroundColor: '#1d4ed8',
    paddingVertical: 16, borderRadius: 12, alignItems: 'center',
    marginTop: 24,
  },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
