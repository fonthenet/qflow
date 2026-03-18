import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { colors, fontSize, spacing, borderRadius } from '@/lib/theme';

export default function OperatorLayout() {
  const router = useRouter();
  const { staffRole } = useAuth();
  const isAdmin = staffRole === 'admin' || staffRole === 'manager' || staffRole === 'branch_admin';

  const backToAdmin = isAdmin
    ? () => (
        <TouchableOpacity
          style={ls.backBtn}
          onPress={() => router.navigate('/(admin)')}
        >
          <Ionicons name="arrow-back" size={18} color="#fff" />
          <Text style={ls.backText}>Admin</Text>
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
        headerLeft: backToAdmin,
      }}
    >
      <Tabs.Screen
        name="desk"
        options={{
          title: 'My Desk',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="desktop-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: 'Queue',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cog-outline" size={size} color={color} />
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
});
