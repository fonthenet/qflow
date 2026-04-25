/**
 * useSheetAnim — eliminates the "ghost flash" you get from RN's
 * `<Modal animationType="slide" transparent>` pattern.
 *
 * Why the flash happens: `animationType="slide"` on a transparent modal
 * slides the ENTIRE modal layer (backdrop included) up from the bottom.
 * During the ~250 ms slide, the upper portion of the screen has no
 * backdrop yet, so the underlying view shows un-dimmed for a frame —
 * that's the "ghost flash in the empty space" we kept seeing.
 *
 * The fix: drive the Modal with `animationType="fade"` so the backdrop
 * fades in opaque from frame 1 (no flash), and slide the sheet itself
 * up via this `translateY` value. Combined effect = backdrop fades,
 * sheet slides — same motion the user expected, without the flash.
 *
 * Usage:
 *   const translateY = useSheetAnim(visible);
 *   <Modal animationType="fade" transparent statusBarTranslucent ...>
 *     <View style={styles.backdrop}>
 *       <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
 *         ...
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

const HIDDEN_OFFSET = 600; // px below screen — far enough for any sheet

export function useSheetAnim(visible: boolean) {
  const translateY = useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : HIDDEN_OFFSET,
      duration: visible ? 260 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, translateY]);
  return translateY;
}
