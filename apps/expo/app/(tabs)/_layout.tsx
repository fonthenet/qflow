import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/lib/auth-context';

export default function TabLayout() {
  const { t } = useTranslation();
  const { activeToken } = useAppStore();
  const { colors, isDark } = useTheme();
  const { isStaff } = useAuth();
  const router = useRouter();
  // When tracking, force dark regardless of theme
  const isTrackingDark = !!activeToken;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: isTrackingDark ? '#38bdf8' : colors.primary,
        tabBarInactiveTintColor: isTrackingDark ? '#64748b' : colors.textMuted,
        tabBarStyle: {
          backgroundColor: isTrackingDark ? '#0f172a' : colors.surface,
          borderTopColor: isTrackingDark ? '#1e293b' : colors.border,
        },
        headerStyle: { backgroundColor: isTrackingDark ? '#020617' : colors.surface },
        headerTintColor: isTrackingDark ? '#f8fafc' : colors.text,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.queue'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ticket-outline" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: () => {
            // Only clear the active ticket when it's actually finished.
            // For waiting / called / serving we keep it so the Queue tab
            // lands the user right on the live status view.
            const { activeTicket, clearActiveTicket } = useAppStore.getState();
            const terminal =
              !!activeTicket &&
              ['served', 'no_show', 'cancelled'].includes(activeTicket.status);
            if (terminal) clearActiveTicket();
          },
        }}
      />
      <Tabs.Screen
        name="places"
        options={{
          title: t('tabs.places'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="station"
        options={{
          title: t('tabs.station'),
          href: isStaff ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="desktop-outline" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/(operator)/desk');
          },
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs.history'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
