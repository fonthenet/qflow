import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { borderRadius, fontSize, spacing } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isStaff, staffRole, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!authLoading && user && isStaff) {
      if (staffRole === 'admin' || staffRole === 'manager' || staffRole === 'branch_admin') {
        router.replace('/(admin)');
      } else {
        router.replace('/(auth)/role-select');
      }
    }
  }, [authLoading, user, isStaff, staffRole]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const handleLogin = async () => {
    if (!email.trim()) {
      Alert.alert('Email Required', 'Please enter your staff email address.');
      return;
    }
    if (!password.trim()) {
      Alert.alert('Password Required', 'Please enter your password.');
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
          Alert.alert('Login Failed', 'Incorrect email or password. Please try again.');
        } else if (msg.includes('email not confirmed')) {
          Alert.alert('Email Not Confirmed', 'Please check your email and confirm your account first.');
        } else if (msg.includes('too many requests')) {
          Alert.alert('Too Many Attempts', 'Please wait a moment before trying again.');
        } else {
          Alert.alert('Login Failed', error.message);
        }
      } else if (data.user) {
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
      Alert.alert('Connection Error', 'Could not connect to the server. Check your internet and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Enter Your Email', 'Type your email address in the field above, then tap Forgot Password.');
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'queueflow://reset-password',
      });
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Alert.alert('Check Your Email', `A password reset link has been sent to ${email.trim()}.`);
      }
    } catch {
      Alert.alert('Error', 'Could not send reset email. Please try again.');
    }
  };

  return (
    <LinearGradient colors={['#1e40af', '#3b82f6', '#6366f1']} style={styles.gradient}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.xxl,
            paddingBottom: keyboardHeight > 0 ? keyboardHeight + spacing.lg : insets.bottom + spacing.xxl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo & Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>Q</Text>
          </View>
          <Text style={styles.title}>Qflo</Text>
          <Text style={styles.subtitle}>Staff Portal</Text>
        </View>

        {/* Login Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign In</Text>
          <Text style={styles.cardSubtitle}>Enter your staff credentials</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={18} color="#94a3b8" />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="staff@company.com"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                placeholderTextColor="#94a3b8"
                secureTextEntry={!showPassword}
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Remember me + Forgot password */}
          <View style={styles.optionsRow}>
            <TouchableOpacity style={styles.rememberRow} onPress={() => setRememberMe(!rememberMe)} activeOpacity={0.7}>
              <Ionicons name={rememberMe ? 'checkbox' : 'square-outline'} size={18} color={rememberMe ? '#1d4ed8' : '#94a3b8'} />
              <Text style={styles.rememberText}>Remember me</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleForgotPassword} activeOpacity={0.7}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {/* Sign In Button */}
          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Back link */}
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={16} color="rgba(255,255,255,0.8)" />
          <Text style={styles.backLinkText}>Back to customer view</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.xl,
  },
  header: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: 'white',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: spacing.lg + 4,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 8,
  },
  cardTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: fontSize.sm,
    color: '#64748b',
    marginTop: -8,
  },
  inputGroup: {
    gap: 4,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: '#64748b',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#f8fafc',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: spacing.md,
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
    color: '#1d4ed8',
  },
  loginButton: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginTop: spacing.xs,
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: '#fff',
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  backLinkText: {
    fontSize: fontSize.md,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
  },
});
