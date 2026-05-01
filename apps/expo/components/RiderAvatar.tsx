import { Image, StyleSheet, Text, View } from 'react-native';
import { C, initials } from '@/lib/rider-theme';

/**
 * Avatar with image fallback to initials. Used in the rider home
 * header, settings screen, and history list (future). Always
 * circular, sized via the `size` prop.
 */
export function RiderAvatar({ name, url, size = 48 }: { name: string | null | undefined; url?: string | null; size?: number }) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[s.img, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }
  const fontSize = Math.round(size * 0.36);
  return (
    <View style={[s.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[s.initials, { fontSize }]}>{initials(name)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  img: { backgroundColor: C.surface2 },
  fallback: {
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
});
