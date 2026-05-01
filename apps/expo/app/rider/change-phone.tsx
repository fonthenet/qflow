import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';
import { API_BASE_URL } from '@/lib/config';

/**
 * Two-step change-phone flow on a single screen:
 *   1. Rider types new number → tap Send code → POST /change-phone
 *   2. UI swaps to OTP entry → tap Verify → POST /change-phone/verify
 *      → on success refresh() the auth context and pop back.
 *
 * The session bearer token doesn't change. The rider keeps using
 * their existing token; only `riders.phone` is updated server-side.
 */
export default function RiderChangePhoneScreen() {
  const router = useRouter();
  const { token, rider, refresh } = useRiderAuth();
  const [step, setStep] = useState<'enter' | 'verify'>('enter');
  const [newPhone, setNewPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (step === 'verify') {
      const t = setTimeout(() => codeRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [step]);

  if (!rider || !token) {
    return null;
  }

  async function sendCode() {
    if (busy) return;
    if (!/^\+?\d{6,20}$/.test(newPhone.trim())) {
      setError('Enter a valid number.');
      return;
    }
    if (newPhone.trim() === rider!.phone) {
      setError('That is already your current number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/rider/auth/change-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token!}` },
        body: JSON.stringify({ newPhone: newPhone.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data?.error ?? 'Could not send code.');
        return;
      }
      setStep('verify');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/rider/auth/change-phone/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token!}` },
        body: JSON.stringify({ newPhone: newPhone.trim(), code: code.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data?.error ?? 'Wrong code.');
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
      <Stack.Screen options={{ title: 'Change number', headerShown: false }} />
      <View style={s.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={22} color="#475569" />
          <Text style={s.backText}>Back</Text>
        </Pressable>
        <Text style={s.title}>Change number</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {step === 'enter' ? (
            <>
              <Text style={s.subtitle}>
                We'll send a 6-digit code to your new WhatsApp number.
              </Text>
              <Text style={s.label}>Current</Text>
              <Text style={s.current}>{rider!.phone}</Text>

              <Text style={[s.label, { marginTop: 16 }]}>New WhatsApp number</Text>
              <TextInput
                value={newPhone}
                onChangeText={(v) => { setNewPhone(v); setError(null); }}
                placeholder="+213 …"
                placeholderTextColor="#94a3b8"
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="tel"
                style={s.input}
                editable={!busy}
                onSubmitEditing={sendCode}
              />
              {error ? <Text style={s.error}>{error}</Text> : null}

              <Pressable
                onPress={sendCode}
                disabled={busy}
                style={({ pressed }) => [
                  s.btn,
                  busy && s.btnDisabled,
                  pressed && !busy && s.btnPressed,
                ]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send code</Text>}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.subtitle}>
                Enter the 6-digit code sent to{'\n'}
                <Text style={{ fontWeight: '700', color: '#0f172a' }}>{newPhone.trim()}</Text>
              </Text>
              <TextInput
                ref={codeRef}
                value={code}
                onChangeText={(v) => {
                  const d = v.replace(/\D/g, '').slice(0, 6);
                  setCode(d);
                  setError(null);
                }}
                placeholder="000000"
                placeholderTextColor="#cbd5e1"
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                maxLength={6}
                style={s.codeInput}
                editable={!busy}
                onSubmitEditing={verify}
              />
              {error ? <Text style={s.error}>{error}</Text> : null}

              <Pressable
                onPress={verify}
                disabled={busy}
                style={({ pressed }) => [
                  s.btn,
                  busy && s.btnDisabled,
                  pressed && !busy && s.btnPressed,
                ]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify & change</Text>}
              </Pressable>

              <Pressable
                onPress={() => { setStep('enter'); setCode(''); setError(null); }}
                hitSlop={8}
              >
                <Text style={s.link}>Use a different number</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  scroll: { padding: 24 },
  subtitle: { fontSize: 15, color: '#64748b', lineHeight: 22, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  current: { fontSize: 15, color: '#0f172a', fontWeight: '600' },
  input: {
    width: '100%', backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 17, color: '#0f172a',
  },
  codeInput: {
    width: '100%', backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
    paddingVertical: 18,
    fontSize: 28, fontWeight: '700',
    letterSpacing: 12,
    textAlign: 'center', color: '#0f172a',
  },
  error: { color: '#dc2626', fontSize: 13, marginTop: 8 },
  btn: {
    width: '100%', backgroundColor: '#1d4ed8',
    paddingVertical: 16, borderRadius: 12, alignItems: 'center',
    marginTop: 24,
  },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: '#1d4ed8', fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 18, padding: 8 },
});
