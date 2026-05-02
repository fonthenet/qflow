import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation, Stack } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';

/**
 * OTP entry. On success, the auth context flips to authenticated and
 * the parent gate routes us to /rider (home). We just replace() to
 * /rider on success — the gate handles where the rider actually
 * lands.
 */
export default function RiderVerifyScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const phoneStr = String(phone ?? '');
  const { verifyLogin, startLogin } = useRiderAuth();

  // Reset the rider stack to just [home] on successful login. Without
  // this the stack stays [login, verify, home] and the iOS swipe-back
  // gesture (or Android back) takes the rider back to login. Use
  // CommonActions.reset because router.replace only swaps the *current*
  // screen — it doesn't drop earlier entries from the stack.
  function landOnHome() {
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'index' }] }),
    );
  }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(60);
  const inputRef = useRef<TextInput | null>(null);

  // Countdown for the resend button.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // Auto-focus the code field on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  async function onSubmit() {
    if (busy || !/^\d{6}$/.test(code.trim())) return;
    setBusy(true);
    setError(null);
    const r = await verifyLogin(phoneStr, code.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Invalid code.');
      return;
    }
    landOnHome();
  }

  async function onResend() {
    if (resendIn > 0 || busy) return;
    setBusy(true);
    setError(null);
    await startLogin(phoneStr);
    setBusy(false);
    setResendIn(60);
  }

  const valid = /^\d{6}$/.test(code.trim());

  return (
    <View style={s.root}>
      <Stack.Screen options={{ title: 'Verify' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color="#475569" />
            <Text style={s.backText}>Back</Text>
          </Pressable>

          <View style={s.iconBubble}>
            <Ionicons name="chatbubble-ellipses" size={36} color="#fff" />
          </View>
          <Text style={s.title}>Enter the code</Text>
          <Text style={s.subtitle}>
            We sent a 6-digit code to{'\n'}
            <Text style={{ fontWeight: '700', color: '#0f172a' }}>{phoneStr}</Text>
          </Text>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              setError(null);
              if (digits.length === 6) {
                // Auto-submit on full code entry.
                setTimeout(() => onSubmitInternal(digits), 0);
              }
            }}
            placeholder="000000"
            placeholderTextColor="#cbd5e1"
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            style={s.codeInput}
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
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify</Text>}
          </Pressable>

          <Pressable onPress={onResend} disabled={resendIn > 0 || busy} hitSlop={8}>
            <Text style={[s.resend, (resendIn > 0 || busy) && { color: '#94a3b8' }]}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );

  // Pulled out for the auto-submit path so we can pass the freshly-typed
  // code in without waiting for the next render.
  async function onSubmitInternal(c: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await verifyLogin(phoneStr, c);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Invalid code.');
      setCode('');
      inputRef.current?.focus();
      return;
    }
    landOnHome();
  }
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 24 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { color: '#475569', fontSize: 15, marginLeft: 2 },
  iconBubble: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#1d4ed8',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 24, marginBottom: 20, alignSelf: 'center',
  },
  title: { fontSize: 24, fontWeight: '800', color: '#0f172a', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#64748b', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  codeInput: {
    width: '100%', backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
    paddingVertical: 18,
    fontSize: 28, fontWeight: '700',
    letterSpacing: 12,
    textAlign: 'center', color: '#0f172a',
  },
  error: { color: '#dc2626', fontSize: 13, marginTop: 8, textAlign: 'center' },
  btn: {
    width: '100%', backgroundColor: '#1d4ed8',
    paddingVertical: 16, borderRadius: 12, alignItems: 'center',
    marginTop: 24,
  },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  resend: { color: '#1d4ed8', fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 18, padding: 8 },
});
