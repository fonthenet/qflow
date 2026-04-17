import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { borderRadius, fontSize, spacing } from '@/lib/theme';

// Keys for credential storage. SecureStore encrypts at the OS level
// (iOS Keychain, Android Keystore) — the right home for a saved password.
const CRED_EMAIL_KEY = 'qflo_login_email';
const CRED_PASSWORD_KEY = 'qflo_login_password';
const CRED_REMEMBER_KEY = 'qflo_login_remember';

const { width: SCREEN_W } = Dimensions.get('window');

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user, isStaff, staffRole, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!authLoading && user && isStaff) {
      if (staffRole === 'admin' || staffRole === 'manager' || staffRole === 'branch_admin') {
        router.replace('/(admin)');
      } else {
        router.replace('/(auth)/role-select');
      }
    }
  }, [authLoading, user, isStaff, staffRole]);

  // Restore saved credentials if the user previously checked "Remember me"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [savedEmail, savedPassword, savedRemember] = await Promise.all([
          SecureStore.getItemAsync(CRED_EMAIL_KEY),
          SecureStore.getItemAsync(CRED_PASSWORD_KEY),
          SecureStore.getItemAsync(CRED_REMEMBER_KEY),
        ]);
        if (cancelled) return;
        // Only prefill if the user opted in last time (remember === 'true')
        if (savedRemember === 'true') {
          if (savedEmail) setEmail(savedEmail);
          if (savedPassword) setPassword(savedPassword);
          setRememberMe(true);
        } else if (savedRemember === 'false') {
          setRememberMe(false);
        }
      } catch { /* secure-store can fail on some devices; default state is fine */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogin = async () => {
    if (!email.trim()) {
      Alert.alert(t('auth.emailRequired'), t('auth.emailRequiredMsg'));
      return;
    }
    if (!password.trim()) {
      Alert.alert(t('auth.passwordRequired'), t('auth.passwordRequiredMsg'));
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
          Alert.alert(t('auth.loginFailed'), t('auth.loginFailedMsg'));
        } else if (msg.includes('email not confirmed')) {
          Alert.alert(t('auth.emailNotConfirmed'), t('auth.emailNotConfirmedMsg'));
        } else if (msg.includes('too many requests')) {
          Alert.alert(t('auth.tooManyAttempts'), t('auth.tooManyAttemptsMsg'));
        } else {
          Alert.alert(t('auth.loginFailed'), error.message);
        }
      } else if (data.user) {
        // Persist or clear saved credentials based on the checkbox
        try {
          await SecureStore.setItemAsync(CRED_REMEMBER_KEY, rememberMe ? 'true' : 'false');
          if (rememberMe) {
            await SecureStore.setItemAsync(CRED_EMAIL_KEY, email.trim());
            await SecureStore.setItemAsync(CRED_PASSWORD_KEY, password);
          } else {
            await SecureStore.deleteItemAsync(CRED_EMAIL_KEY);
            await SecureStore.deleteItemAsync(CRED_PASSWORD_KEY);
          }
        } catch { /* non-fatal — login still succeeds */ }

        const { data: staff } = await supabase
          .from('staff')
          .select('role')
          .eq('auth_user_id', data.user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        const role = staff?.role;
        if (role === 'admin' || role === 'manager' || role === 'branch_admin') {
          router.replace('/(admin)');
        } else {
          router.replace('/(auth)/role-select');
        }
      }
    } catch {
      Alert.alert(t('auth.connectionError'), t('auth.connectionErrorMsg'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert(t('auth.enterEmail'), t('auth.enterEmailMsg'));
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'qflo://reset-password',
      });
      if (error) {
        Alert.alert(t('common.error'), error.message);
      } else {
        Alert.alert(t('auth.checkEmail'), t('auth.checkEmailMsg', { email: email.trim() }));
      }
    } catch {
      Alert.alert(t('common.error'), t('auth.resetError'));
    }
  };

  return (
    <>
    <StatusBar style="light" />
    <LinearGradient colors={['#1e40af', '#2563eb', '#4f46e5']} style={styles.gradient}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + 20,
              paddingBottom: insets.bottom + 16,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Logo & Header — compact, pushed to top */}
          <View style={styles.header}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>Q</Text>
            </View>
            <Text style={styles.title}>Qflo</Text>
            <Text style={styles.subtitle}>{t('auth.staffPortal')}</Text>
          </View>

          {/* Login Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('auth.welcomeBack')}</Text>

            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={17} color="#94a3b8" />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth.emailPlaceholder')}
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={17} color="#94a3b8" />
              <TextInput
                ref={passwordRef}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.passwordPlaceholder')}
                placeholderTextColor="#94a3b8"
                secureTextEntry={!showPassword}
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={17} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Remember me + Forgot password */}
            <View style={styles.optionsRow}>
              <TouchableOpacity style={styles.rememberRow} onPress={() => setRememberMe(!rememberMe)} activeOpacity={0.7}>
                <Ionicons name={rememberMe ? 'checkbox' : 'square-outline'} size={16} color={rememberMe ? '#2563eb' : '#94a3b8'} />
                <Text style={styles.rememberText}>{t('auth.rememberMe')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleForgotPassword} activeOpacity={0.7}>
                <Text style={styles.forgotText}>{t('auth.forgotPassword')}</Text>
              </TouchableOpacity>
            </View>

            {/* Sign In Button */}
            <TouchableOpacity
              style={[styles.loginButton, loading && styles.loginButtonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#2563eb', '#1d4ed8']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginButtonGradient}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.loginButtonText}>{t('auth.signIn')}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Local Station */}
          <TouchableOpacity
            style={styles.localStationLink}
            onPress={() => router.push('/(auth)/connect-station')}
            activeOpacity={0.7}
          >
            <Ionicons name="wifi" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.localStationText}>{t('connectStation.connectLocal')}</Text>
          </TouchableOpacity>

          {/* Back link */}
          <TouchableOpacity style={styles.backLink} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={16} color="rgba(255,255,255,0.7)" />
            <Text style={styles.backLinkText}>{t('auth.backToCustomer')}</Text>
          </TouchableOpacity>

          {/* Footer */}
          <Text style={styles.footer}>{t('auth.poweredBy')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
    </>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    gap: 12,
  },
  header: {
    alignItems: 'center',
    gap: 2,
  },
  logoCircle: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  logoText: {
    fontSize: 30,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: 'white',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    minHeight: 50,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: fontSize.md,
    color: '#0f172a',
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rememberText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: '#64748b',
  },
  forgotText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: '#2563eb',
  },
  loginButton: {
    marginTop: 0,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  loginButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: '#fff',
  },
  localStationLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  localStationText: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  backLinkText: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
  footer: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 'auto' as any,
    paddingTop: spacing.md,
  },
});
