import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, Animated, PanResponder, StyleSheet,
  useWindowDimensions, Platform,
  type ViewStyle, type NativeTouchEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  clampPan, distance, FIT, midpoint, MIN_SCALE, MAX_SCALE, toggleZoom, zoomAbout,
  type Frame, type Point, type Transform,
} from '../lib/photoZoom';

interface Props {
  visible: boolean;
  /** Signed URLs, in the order the strip shows them. */
  photos: string[];
  /** Which one was tapped. */
  startIndex?: number;
  onClose: () => void;
}

/** A tap and a second tap are one gesture only if they are this close together. */
const DOUBLE_TAP_MS = 300;
/** …and land within this of each other. A drag is not a tap. */
const TAP_SLOP = 12;

const isZoomed = (t: Transform) => t.scale > MIN_SCALE + 0.01;

/**
 * A photo, full screen, that can be got closer to.
 *
 * The photo **is** the snag. There is no title column in this app precisely
 * because a picture of the broken toilet seat says what a title would — so a
 * 220×165 tile in a horizontal strip is the only account of the problem
 * anybody gets, and a serial number, a model plate or a hairline crack is not
 * legible in one. Tapping it had no effect at all, which left the strip
 * looking like the whole answer.
 *
 * ## Why this is hand-rolled
 *
 * The obvious answers do not survive this project's two constraints.
 * `ScrollView`'s `maximumZoomScale` is iOS-native only, and **the build people
 * actually install is the web export** — it would work on the phone in the
 * simulator and do nothing on the phone in the kitchen, which is the exact
 * shape of failure `Alert.alert` and `KeyboardAvoidingView` already caught this
 * codebase out with. `react-native-gesture-handler` is not a dependency, needs
 * a root-view wrapper on native, and would be a second animation runtime plus
 * bundle weight on a web export that just paid 490 KB for the PDF renderer.
 *
 * `PanResponder` is core React Native, is implemented on react-native-web, and
 * reports `touches` — which is everything a pinch needs. The arithmetic is in
 * `lib/photoZoom.ts` with its own test; this file is gestures and chrome.
 *
 * ## Three things that are load-bearing
 *
 * - **The controls are siblings of the pan surface, not children of it.** A
 *   `Pressable` inside a view holding `panHandlers` is a coin toss about which
 *   one gets the tap — the same trap the Thing page's photo tile already
 *   documents.
 * - **There are buttons as well as gestures.** Half the people opening this are
 *   on a desktop browser with no pinch and no second finger, and a viewer whose
 *   only way in is a gesture that device cannot make is a viewer that does
 *   nothing. `Fit` appears only once zoomed, because at fit it is a no-op
 *   dressed as a control.
 * - **`touchAction: 'none'` on web.** Without it the browser takes the pinch
 *   and zooms the *page*, so the photo stays exactly as it was inside a
 *   scaled-up app. The viewport meta deliberately still allows page zoom
 *   everywhere else, so this is scoped to the surface that handles its own.
 */
export default function PhotoViewer({ visible, photos, startIndex = 0, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [index, setIndex] = useState(startIndex);
  // Two booleans rather than the live scale, deliberately: they only flip at
  // the two ends, so a pinch re-renders twice instead of sixty times a second.
  const [zoomed, setZoomed] = useState(false);
  const [atMax, setAtMax] = useState(false);

  const frame = useRef<Frame>({ width, height });
  frame.current = { width, height };

  const transform = useRef<Transform>(FIT);
  const scale = useRef(new Animated.Value(FIT.scale)).current;
  const tx = useRef(new Animated.Value(FIT.x)).current;
  const ty = useRef(new Animated.Value(FIT.y)).current;

  // Gesture bookkeeping. A pinch and a drag are the same stream of events with
  // a different number of fingers in it, and a finger lifting mid-gesture has
  // to re-baseline rather than jump.
  const pinch = useRef<{ from: Transform; span: number; focus: Point } | null>(null);
  const drag = useRef<{ from: Transform; dx: number; dy: number } | null>(null);
  const lastTap = useRef<{ at: number; point: Point }>({ at: 0, point: { x: 0, y: 0 } });

  const apply = useCallback((next: Transform, animate = false) => {
    transform.current = next;
    setZoomed(isZoomed(next));
    setAtMax(next.scale >= MAX_SCALE - 0.01);
    if (animate) {
      Animated.parallel([
        Animated.timing(scale, { toValue: next.scale, duration: 160, useNativeDriver: true }),
        Animated.timing(tx, { toValue: next.x, duration: 160, useNativeDriver: true }),
        Animated.timing(ty, { toValue: next.y, duration: 160, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(next.scale);
      tx.setValue(next.x);
      ty.setValue(next.y);
    }
  }, [scale, tx, ty]);

  const reset = useCallback(() => apply(FIT, true), [apply]);

  // A new photo arrives at fit. Carrying the previous one's zoom over would
  // open the next picture somewhere in the middle of itself.
  useEffect(() => { setIndex(startIndex); }, [startIndex, visible]);
  useEffect(() => { apply(FIT); }, [index, visible, apply]);

  /** A touch, in points measured from the centre of the frame. */
  const fromCentre = useCallback((touch: NativeTouchEvent): Point => ({
    x: touch.pageX - frame.current.width / 2,
    y: touch.pageY - frame.current.height / 2,
  }), []);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: () => {
      pinch.current = null;
      drag.current = null;
    },

    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;

      if (touches.length >= 2) {
        drag.current = null;
        const a = fromCentre(touches[0]);
        const b = fromCentre(touches[1]);
        const span = distance(a, b);
        if (!pinch.current || pinch.current.span === 0) {
          pinch.current = { from: transform.current, span, focus: midpoint(a, b) };
          return;
        }
        const p = pinch.current;
        apply(zoomAbout(p.from, p.from.scale * (span / p.span), p.focus, frame.current));
        return;
      }

      // One finger. Only meaningful once there is more picture than frame —
      // at fit there is nowhere to go, and dragging a fitted photo around
      // would be the app appearing to respond and changing nothing.
      pinch.current = null;
      if (!isZoomed(transform.current)) return;
      if (!drag.current) {
        drag.current = { from: transform.current, dx: gesture.dx, dy: gesture.dy };
      }
      const d = drag.current;
      apply(clampPan({
        scale: d.from.scale,
        x: d.from.x + (gesture.dx - d.dx),
        y: d.from.y + (gesture.dy - d.dy),
      }, frame.current));
    },

    onPanResponderRelease: (event, gesture) => {
      const wasPinching = pinch.current !== null;
      pinch.current = null;
      drag.current = null;

      const moved = Math.abs(gesture.dx) + Math.abs(gesture.dy);
      if (wasPinching || moved > TAP_SLOP) return;

      const point = { x: gesture.x0 - width / 2, y: gesture.y0 - height / 2 };
      const now = Date.now();
      const previous = lastTap.current;
      if (now - previous.at < DOUBLE_TAP_MS && distance(point, previous.point) < MIN_TOUCH_TARGET) {
        lastTap.current = { at: 0, point };
        apply(toggleZoom(transform.current, point, frame.current), true);
        return;
      }
      lastTap.current = { at: now, point };
    },

    onPanResponderTerminate: () => {
      pinch.current = null;
      drag.current = null;
    },
  }), [apply, fromCentre, width, height]);

  const step = useCallback((by: number) => {
    apply(zoomAbout(transform.current, transform.current.scale * by, { x: 0, y: 0 }, frame.current), true);
  }, [apply]);

  const go = useCallback((by: number) => {
    setIndex((current) => Math.min(photos.length - 1, Math.max(0, current + by)));
  }, [photos.length]);

  const uri = photos[index];
  if (!visible || !uri) return null;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={[styles.stage, webTouch]} {...pan.panHandlers}>
          <Animated.Image
            source={{ uri }}
            resizeMode="contain"
            accessibilityLabel="The photo, full screen"
            style={[
              styles.image,
              { transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
            ]}
          />
        </View>

        <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]} pointerEvents="box-none">
          {photos.length > 1 ? (
            <Text style={styles.counter}>{index + 1} of {photos.length}</Text>
          ) : <View />}
          <Round icon="close" label="Close" onPress={onClose} />
        </View>

        <View
          style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.lg }]}
          pointerEvents="box-none"
        >
          {photos.length > 1 ? (
            <Round icon="chevron-back" label="Previous photo" onPress={() => go(-1)} disabled={index === 0} />
          ) : null}
          <Round icon="remove" label="Zoom out" onPress={() => step(1 / 1.6)} disabled={!zoomed} />
          {zoomed ? <Round icon="scan-outline" label="Fit to screen" onPress={reset} /> : null}
          <Round
            icon="add"
            label="Zoom in"
            onPress={() => step(1.6)}
            disabled={atMax}
          />
          {photos.length > 1 ? (
            <Round
              icon="chevron-forward"
              label="Next photo"
              onPress={() => go(1)}
              disabled={index === photos.length - 1}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Round({
  icon, label, onPress, disabled,
}: { icon: 'close' | 'add' | 'remove' | 'scan-outline' | 'chevron-back' | 'chevron-forward';
  label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.round, disabled && styles.roundOff]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Icon name={icon} size="md" color={disabled ? Colors.textMuted : Colors.white} />
    </Pressable>
  );
}

/**
 * Hand the surface its own touches on web. Without this the browser claims the
 * pinch for page zoom and the photo never moves — a silent failure on the only
 * build most people run.
 *
 * `touchAction` is a real react-native-web style and not in React Native's
 * `ViewStyle`, which is why this is cast rather than inlined.
 */
const webTouch: ViewStyle | undefined = Platform.OS === 'web'
  ? ({ touchAction: 'none' } as unknown as ViewStyle)
  : undefined;

const styles = StyleSheet.create({
  // Near-opaque rather than a scrim. A photo being read closely wants nothing
  // behind it, and the warm ink keeps the viewer from reading as another app.
  root: { flex: 1, backgroundColor: Colors.photoViewerBackdrop },
  stage: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  counter: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.button,
    backgroundColor: Colors.photoOverlay,
    overflow: 'hidden',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  round: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.photoOverlay,
  },
  roundOff: { opacity: 0.4 },
});
