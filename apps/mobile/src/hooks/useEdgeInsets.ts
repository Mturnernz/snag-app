import React, { useContext, useMemo } from 'react';
import * as SafeArea from 'react-native-safe-area-context';
import { currentDisplayMode, edgeInsets, Insets } from '../lib/edgeInsets';

const NONE: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

/*
 * Read from the context where there is one, rather than through
 * `useSafeAreaInsets`, which throws outside a provider — a sheet rendered on its
 * own gets the floors, not a crash. Decided once, at module scope, so the same
 * hook is called on every render.
 */
const context = (SafeArea as { SafeAreaInsetsContext?: React.Context<Insets | null> })
  .SafeAreaInsetsContext;
const useSafeInsets: () => Insets = context
  ? () => useContext(context) ?? NONE
  : SafeArea.useSafeAreaInsets;

/**
 * The safe-area insets, floored so nothing tappable sits on the glass's edge.
 * Use this, not `useSafeAreaInsets`, anywhere a control is placed against an
 * edge of the screen — see `lib/edgeInsets.ts` for why the two differ.
 */
export function useEdgeInsets(): Insets {
  const safe = useSafeInsets();
  return useMemo(
    () => edgeInsets(safe, currentDisplayMode()),
    [safe.top, safe.bottom, safe.left, safe.right],
  );
}
