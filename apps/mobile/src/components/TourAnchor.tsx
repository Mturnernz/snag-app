import React, { useEffect, useRef } from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { TourAnchorId } from '@snag/onboarding-guide';

import { useTour } from '../context/TourContext';

interface Props {
  /** Must be a key of TOUR_ANCHORS. `tour.test.ts` scans this file's callers
   *  for these literals and checks the set against the package both ways, so a
   *  renamed control fails the build rather than producing a spotlight over
   *  empty space. */
  id: TourAnchorId;
  /** Passed through because wrapping a control in a View changes its layout —
   *  a flex child needs its flex back. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * Marks a control the walkthrough can point at.
 *
 * A plain View that registers itself with the provider, which measures it when
 * a step needs it. `collapsable={false}` is load-bearing: without it Android's
 * view flattening removes a View that only wraps, and `measureInWindow` then
 * reports nothing at all — on Android only, which is the kind of difference
 * that ships.
 */
export default function TourAnchor({ id, style, children }: Props) {
  const ref = useRef<View>(null);
  const { registerAnchor } = useTour();

  useEffect(() => registerAnchor(id, ref), [id, registerAnchor]);

  return (
    <View ref={ref} style={style} collapsable={false}>
      {children}
    </View>
  );
}
