import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Returns an extra bottom padding (in pixels) equal to the current keyboard
 * height, so ScrollView content stays reachable above the keyboard.
 *
 * Why this over KeyboardAvoidingView / automaticallyAdjustKeyboardInsets?
 *  - KAV with behavior="padding" compresses the ScrollView so long forms
 *    can't scroll to their bottom-most elements (classic bug).
 *  - `automaticallyAdjustKeyboardInsets` only works when the ScrollView is
 *    the immediate child of the UINavigationController — we have custom
 *    headers, so it silently no-ops on many screens.
 *
 * Add the returned number to your ScrollView's `contentContainerStyle`
 * paddingBottom (usually on top of whatever base padding you already have).
 *
 * @param extra Optional breathing room added to the keyboard height (e.g. to
 *              clear a submit button that would otherwise sit right at the
 *              keyboard edge). Defaults to 24.
 */
export function useKeyboardPadding(extra = 24): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvt, (e) => {
      setHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setHeight(0));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height > 0 ? height + extra : 0;
}
