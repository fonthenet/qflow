import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '@/lib/theme';

// This is a redirect screen — tapping the Station tab navigates to the operator section.
// The actual redirect happens in the tab listener, but this serves as fallback.
export default function StationRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/(operator)/desk');
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
