import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

export default function TabLayout() {
  const { activeToken } = useAppStore();
  const { colors, isDark } = useTheme();
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
          title: 'Queue',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ticket-outline" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: () => {
            const { activeToken, clearActiveTicket } = useAppStore.getState();
            if (activeToken) {
              clearActiveTicket();
            }
          },
        }}
      />
      <Tabs.Screen
        name="places"
        options={{
          title: 'Places',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
