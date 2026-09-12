import { useEffect, useState } from 'react';
import { currentKeyboardInset, subscribeKeyboardInset } from '../lib/keyboardInset';

/**
 * The height the on-screen keyboard is covering, for anything pinned to the
 * bottom of a screen. Always 0 on native, where `KeyboardAvoidingView` is real.
 *
 * Use it as `marginBottom`, and drop the safe-area padding while it's non-zero:
 * the keyboard already covers the home indicator, so adding both lifts the bar
 * a whole inset too far.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(currentKeyboardInset);

  useEffect(() => subscribeKeyboardInset(setInset), []);

  return inset;
}
