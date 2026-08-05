import React, { useEffect, useState } from 'react';
import { View, StyleSheet, useWindowDimensions, LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TourAnchorId, TourStep } from '@snag/onboarding-guide';

import { Colors, Radius } from '../constants/theme';
import {
  CALLOUT_ASSUMED_HEIGHT,
  Rect,
  calloutFrame,
  calloutPlacement,
  inflate,
  isUsableTarget,
  scrimRects,
} from '../lib/tourGeometry';
import TourCallout from './TourCallout';

interface Props {
  /** Read fresh on every tick rather than resolved once: an anchor on another
   *  tab doesn't exist until the walkthrough has navigated there and that
   *  screen has mounted, which is after this overlay first renders. */
  getAnchorRef: (id: TourAnchorId) => React.RefObject<View | null> | null;
  anchorId: TourAnchorId | null;
  step: TourStep | null;
  stepNumber: number;
  stepCount: number;
  finished: boolean;
  canAdvance: boolean;
  onNext: () => void;
  onBack: () => void;
  onPause: () => void;
  onFinish: () => void;
}

/**
 * How often the spotlight re-measures its target.
 *
 * Not just a retry budget — a poll. The target moves for reasons no single
 * measurement anticipates: the tab the step lives on is still animating in, the
 * screen's data hasn't loaded so the control isn't mounted yet, or the step
 * says "type" and the keyboard has just pushed the field up the screen. Polling
 * costs one native measure call while an overlay is up and makes all three
 * self-correcting.
 */
const MEASURE_INTERVAL_MS = 200;

/**
 * The dim-and-spotlight layer.
 *
 * Deliberately not a `Modal`. A Modal stacks above the entire navigator, which
 * would hide the tab bar the first steps point at, and it takes every touch —
 * so the control the walkthrough is telling somebody to press would be the one
 * thing they couldn't press. Four scrim rects with a gap between them leave the
 * spotlit control genuinely live.
 *
 * **The scrim dims but never blocks.** It started out swallowing taps outside
 * the hole, on the theory that a walkthrough should keep you on its path. That
 * lasted until the tab-bar step, where the anchor wraps the tab *icon* and the
 * hole therefore stopped just above the word "Report" — so the step said "tap
 * the Report tab" and the half of it people actually aim at was dead. The
 * general form of that bug is worse than the thing blocking bought: it needs
 * the hole to exactly equal the hit area of every control anyone ever anchors,
 * it fails silently, and no test can hold the invariant across future anchors.
 * `pointerEvents="none"` retires the whole class. Nothing is trapped by it
 * either — the walkthrough already has Pause, Skip and Back.
 */
export default function TourOverlay({
  getAnchorRef,
  anchorId,
  step,
  stepNumber,
  stepCount,
  finished,
  canAdvance,
  onNext,
  onBack,
  onPause,
  onFinish,
}: Props) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [target, setTarget] = useState<Rect | null>(null);
  const [calloutHeight, setCalloutHeight] = useState(CALLOUT_ASSUMED_HEIGHT);

  // `useWindowDimensions` is the screen; a percentage would resolve against
  // whatever this happens to be nested in, which is the trap Sheet.tsx hit.
  const { width: vw, height: vh } = window;
  const viewport = { width: vw, height: vh };

  useEffect(() => {
    if (!anchorId) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    const bounds = { width: vw, height: vh };

    const measure = () => {
      const node = getAnchorRef(anchorId)?.current;
      if (!node) {
        setTarget(null);
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        const rect = { x, y, width, height };
        setTarget(isUsableTarget(rect, bounds) ? rect : null);
      });
    };

    measure();
    const timer = setInterval(measure, MEASURE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // The viewport is a dependency rather than a ref read during render: a
    // rotation or a resized browser window restarts the poll, which is both
    // correct and rare.
  }, [anchorId, getAnchorRef, vw, vh]);

  const hole = target ? inflate(target, viewport) : null;
  const { top } = calloutPlacement(hole, viewport, calloutHeight, {
    top: insets.top,
    bottom: insets.bottom,
  });
  const { left, width } = calloutFrame(viewport);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {hole ? (
        scrimRects(hole, viewport).map((r, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[styles.scrim, { left: r.x, top: r.y, width: r.width, height: r.height }]}
          />
        ))
      ) : (
        <View pointerEvents="none" style={[styles.scrim, StyleSheet.absoluteFillObject]} />
      )}

      {hole && (
        <View
          pointerEvents="none"
          style={[
            styles.ring,
            { left: hole.x, top: hole.y, width: hole.width, height: hole.height },
          ]}
        />
      )}

      <View style={[styles.callout, { left, top, width }]}>
        <TourCallout
          step={step}
          stepNumber={stepNumber}
          stepCount={stepCount}
          finished={finished}
          canAdvance={canAdvance}
          onNext={onNext}
          onBack={onBack}
          onPause={onPause}
          onFinish={onFinish}
          onLayout={(e: LayoutChangeEvent) => setCalloutHeight(e.nativeEvent.layout.height)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    backgroundColor: Colors.scrim,
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: Radius.button,
  },
  callout: {
    position: 'absolute',
  },
});
