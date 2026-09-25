import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, Animated, PanResponder, Platform, StyleSheet,
  type LayoutChangeEvent, type ViewStyle,
} from 'react-native';

import Icon from './Icon';
import { Pill } from './Grouped';
import { Colors, Radius, Shadow, Spacing, Typography } from '../constants/theme';
import { describeSupplier, type SupplierEntry } from '@snag/supabase-queries';

interface Props {
  suppliers: SupplierEntry[];
  money: (n: number) => string;
  /** A tap: the supplier's own sheet, to rename them or merge from a list. */
  onOpen: (supplier: SupplierEntry) => void;
  /** A drop, or the Merge pill. The caller confirms before anything is written. */
  onMerge: (from: SupplierEntry, to: SupplierEntry) => void;
  /** True while a row is lifted, so the page can stop scrolling under it. */
  onDragChange: (dragging: boolean) => void;
}

/** How long a press has to be held before the row lifts. */
export const HOLD_MS = 400;

export interface RowBand {
  key: string;
  top: number;
  bottom: number;
}

/**
 * Which row a lifted row is over: the one whose band holds `y`, measured in
 * the list's own coordinates. Its own band, and anywhere outside the list, is
 * nowhere — letting go there puts it back.
 */
export function dropTarget(bands: RowBand[], y: number, fromKey: string): string | null {
  const hit = bands.find((b) => y >= b.top && y < b.bottom);
  return hit && hit.key !== fromKey ? hit.key : null;
}

/**
 * While a drag is live on web, stop the page scrolling under the finger.
 *
 * `scrollEnabled={false}` alone is not enough on the build people install:
 * the browser reads `touch-action` when the touch *starts*, and this touch
 * started as an ordinary press on a scrollable page. A non-passive `touchmove`
 * listener that cancels the move is what drag libraries do for a hold-to-drag,
 * and it works because nothing has scrolled yet — the finger was still for the
 * whole hold, so the first move is still cancelable. Added when the row lifts
 * and always taken off again when it lands.
 */
function holdPage(hold: boolean, stop: (e: Event) => void) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (hold) document.addEventListener('touchmove', stop, { passive: false });
  else document.removeEventListener('touchmove', stop);
}

/**
 * The suppliers on a job, and a way to say two of them are one business.
 *
 * **Press and hold a supplier, drop it on another, confirm.** Supplier is free
 * text, so the same builder arrives as "ReliaBuilder" from the quote and
 * "RELIABUILDER LIMITED" from an emailed invoice, and the page counts them as
 * two. Dropping one on the other asks the page to merge them, which renames the
 * dropped one to the other's spelling across the job — the only thing the
 * rollups need to see one supplier.
 *
 * **The gesture is hand-rolled on `PanResponder`**, the core mechanism
 * `PhotoViewer` already uses, so there is no gesture library and no new
 * dependency. A long press on the row's own `Pressable` lifts it; from then the
 * list's pan responder claims every move (`onMoveShouldSetPanResponderCapture`),
 * which ends the row's press so no tap fires on release. The target is read off
 * the lifted row's centre against the rows' own `onLayout` bands, so it never
 * depends on window coordinates, which differ between web and native.
 *
 * **Three other ways to merge, because a hold is invisible.** The row of a
 * name that looks like another business says *hold and drop onto it to merge*
 * and carries a Merge pill; the sheet a tap opens lists every other supplier
 * with a Merge beside each; and the row's accessibility action opens that
 * sheet. The drag does not scroll the page, so a supplier off screen is merged
 * from the sheet.
 */
export default function SupplierList({ suppliers, money, onOpen, onMerge, onDragChange }: Props) {
  const bands = useRef(new Map<string, { y: number; height: number }>());
  const drag = useRef<{ key: string; over: string | null } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dy = useRef(new Animated.Value(0)).current;

  // Read through a ref so the pan responder, made once, sees this render's props.
  const latest = useRef({ suppliers, onMerge, onDragChange });
  latest.current = { suppliers, onMerge, onDragChange };

  const stopTouch = useRef((e: Event) => {
    if (drag.current && e.cancelable) e.preventDefault();
  }).current;

  function lift(key: string) {
    drag.current = { key, over: null };
    dy.setValue(0);
    setLifted(key);
    setOver(null);
    holdPage(true, stopTouch);
    latest.current.onDragChange(true);
  }

  function land(commit: boolean) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    holdPage(false, stopTouch);
    latest.current.onDragChange(false);
    const list = latest.current.suppliers;
    const from = list.find((s) => s.key === current.key);
    const to = commit && current.over ? list.find((s) => s.key === current.over) : undefined;
    setOver(null);
    Animated.timing(dy, { toValue: 0, duration: 160, useNativeDriver: false }).start(() => setLifted(null));
    if (from && to) latest.current.onMerge(from, to);
  }

  // A list that unmounts mid-drag must not leave the page unable to scroll.
  useEffect(() => () => {
    if (drag.current) {
      holdPage(false, stopTouch);
      latest.current.onDragChange(false);
    }
  }, []);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: () => drag.current !== null,
    onMoveShouldSetPanResponderCapture: () => drag.current !== null,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_event, gesture) => {
      const current = drag.current;
      if (!current) return;
      dy.setValue(gesture.dy);
      const from = bands.current.get(current.key);
      if (!from) return;
      const centre = from.y + from.height / 2 + gesture.dy;
      const next = dropTarget(
        [...bands.current.entries()].map(([key, b]) => ({ key, top: b.y, bottom: b.y + b.height })),
        centre,
        current.key,
      );
      if (next !== current.over) {
        current.over = next;
        setOver(next);
      }
    },
    onPanResponderRelease: () => land(true),
    onPanResponderTerminate: () => land(false),
  }), []);

  const nameOf = (key: string | null) => suppliers.find((s) => s.key === key)?.name ?? '';

  return (
    <View style={styles.group} {...pan.panHandlers}>
      {suppliers.map((supplier, index) => {
        const isLifted = lifted === supplier.key;
        const isTarget = over === supplier.key;
        const into = supplier.mergeInto ? suppliers.find((s) => s.key === supplier.mergeInto) : undefined;
        const facts = describeSupplier(supplier, money);
        return (
          <Animated.View
            key={supplier.key}
            onLayout={(e: LayoutChangeEvent) => {
              const { y, height } = e.nativeEvent.layout;
              bands.current.set(supplier.key, { y, height });
            }}
            style={[
              styles.rowWrap,
              isTarget && styles.target,
              isLifted && styles.lifted,
              isLifted && { transform: [{ translateY: dy }, { scale: 1.02 }] },
            ]}
          >
            {/*
              Hidden rather than removed beside a lifted row: nothing under a
              finger may unmount mid-drag (see the note on the titles below).
            */}
            {index > 0 ? (
              <View style={[styles.separator, (isLifted || lifted === suppliers[index - 1]?.key) && styles.hidden]} />
            ) : null}
            <View style={styles.row}>
              <Pressable
                onPress={() => onOpen(supplier)}
                onLongPress={() => lift(supplier.key)}
                delayLongPress={HOLD_MS}
                style={[styles.rowTap, WEB_NO_SELECT]}
                accessibilityRole="button"
                accessibilityLabel={[supplier.name, facts].filter(Boolean).join(', ')}
                accessibilityHint="Opens the supplier. Press and hold, then drop onto another supplier, to merge them."
                accessibilityActions={[{ name: 'merge', label: 'Merge into another supplier' }]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'merge') onOpen(supplier);
                }}
              >
                {/*
                  **The same elements stay mounted for the whole drag; only
                  their words change.** A touch belongs to the element it
                  started on, and if that element leaves the page mid-drag the
                  browser stops delivering the touch to anything the app is
                  listening on — the row followed the finger and then never
                  heard it lift. Mouse events are hit-tested afresh, so this
                  only ever broke on a phone.
                */}
                <View style={styles.titles}>
                  <Text style={styles.title} numberOfLines={2}>{supplier.name}</Text>
                  <Text style={isLifted && over ? styles.drop : styles.subtitle}>
                    {isLifted && over ? `Drop to merge into ${nameOf(over)}` : facts}
                  </Text>
                  {into ? (
                    <Text style={styles.subtitle}>{`Looks like ${into.name} · hold and drop onto it to merge`}</Text>
                  ) : null}
                </View>
                {into ? null : <Icon name="chevron-forward" size={16} color={Colors.chevron} />}
              </Pressable>
              {into ? (
                <Pill
                  label="Merge"
                  onPress={() => onMerge(supplier, into)}
                  accessibilityLabel={`Merge ${supplier.name} into ${into.name}`}
                />
              ) : null}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

/**
 * A hold must not select the row's text or raise iOS Safari's callout, which
 * would take the gesture before the row could lift. Web-only style keys.
 */
const WEB_NO_SELECT: ViewStyle = Platform.OS === 'web'
  ? ({ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as unknown as ViewStyle)
  : {};

const styles = StyleSheet.create({
  // Not the shared Group: that one clips to its corners, and a lifted row's
  // shadow has to be able to spill past the rows around it.
  group: { backgroundColor: Colors.surface, borderRadius: Radius.card },
  rowWrap: { backgroundColor: Colors.surface, borderRadius: Radius.card },
  separator: { height: StyleSheet.hairlineWidth * 2, backgroundColor: Colors.separator, marginLeft: Spacing.lg },
  hidden: { opacity: 0 },
  // The fern tint is an interaction state: this is where letting go lands.
  target: { backgroundColor: Colors.primaryLight },
  lifted: { zIndex: 10, ...Shadow.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.md },
  rowTap: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    minHeight: 52, paddingVertical: Spacing.sm + 2, paddingLeft: Spacing.lg,
  },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: Typography.body, lineHeight: 22, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textMuted },
  drop: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.primary, fontWeight: Typography.semibold },
});
