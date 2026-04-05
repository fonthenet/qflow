import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import { colors, fontSize, spacing, borderRadius } from '@/lib/theme';

export default function OperatorLayout() {
  const router = useRouter();
  const { staffRole } = useAuth();
  const { t } = useTranslation();
  const localMode = useLocalConnectionStore((s) => s.mode);
  const connectionStatus = useLocalConnectionStore((s) => s.connectionStatus);
  const isLocal = localMode === 'local';
  const isAdmin = staffRole === 'admin' || staffRole === 'manager' || staffRole === 'branch_admin';

  // In local mode: no back-to-admin (there is no admin in local mode)
  const headerLeft = !isLocal && isAdmin
    ? () => (
        <TouchableOpacity
          style={ls.backBtn}
          onPress={() => router.navigate('/(admin)')}
        >
          <Ionicons name="arrow-back" size={18} color="#fff" />
          <Text style={ls.backText}>{t('nav.admin')}</Text>
        </TouchableOpacity>
      )
    : () => null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
        tabBarStyle: {
          backgroundColor: colors.primary,
          borderTopColor: 'rgba(255,255,255,0.15)',
        },
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerShadowVisible: false,
        headerBackVisible: false,
        headerLeft,
        headerRight: isLocal
          ? () => (
              <TouchableOpacity
                style={ls.localBadge}
                onPress={() => router.push('/(operator)/settings')}
                activeOpacity={0.7}
              >
                <View style={[ls.localDot, connectionStatus === 'error' && ls.localDotError]} />
                <Text style={ls.localText}>{t('connectStation.localMode')}</Text>
                <Ionicons name="chevron-down" size={12} color="#86efac" />
              </TouchableOpacity>
            )
          : undefined,
      }}
    >
      <Tabs.Screen
        name="desk"
        options={{
          title: t('admin.myDesk'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="desktop-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="booking"
        options={{
          title: t('booking.newTicket'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: t('admin.queue'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings.title', { defaultValue: 'Settings' }),
          // Show settings in tab bar only in local mode (it's the exit point)
          href: isLocal ? '/(operator)/settings' : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const ls = StyleSheet.create({
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  backText: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  localBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginRight: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  localDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  localDotError: {
    backgroundColor: '#ef4444',
  },
  localText: {
    color: '#86efac',
    fontSize: 10,
    fontWeight: '700',
  },
});
