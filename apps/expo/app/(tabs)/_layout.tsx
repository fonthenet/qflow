import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

export default function TabLayout() {
  const { t } = useTranslation();
  const { activeToken } = useAppStore();
  const { colors } = useTheme();
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
          title: t('tabs.active', { defaultValue: 'Active' }),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pulse-outline" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: () => {
            // Only clear the active ticket when it's actually finished.
            // For waiting / called / serving we keep it so the Active tab
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
        name="history"
        options={{
          title: t('tabs.history', { defaultValue: 'Activity' }),
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
      {/* Station moved out of the tab bar — access via Profile. The file
          remains as a redirect in case anyone deep-links to the tab. */}
      <Tabs.Screen name="station" options={{ href: null }} />
    </Tabs>
  );
}
