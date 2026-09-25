import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { expectedAmountIncl, type ExpectedMatch } from '@snag/supabase-queries';

interface Props {
  /** The expected payment on offer. */
  match: ExpectedMatch;
  /** Whether saving will take it off *Expected to pay*. */
  ticked: boolean;
  /** Whether there is another match to offer instead. */
  more: boolean;
  money: (n: number) => string;
  onToggle: () => void;
  onNext: () => void;
  /** On a white card the line sits in a sunken well rather than on its own group. */
  style?: StyleProp<ViewStyle>;
}

/**
 * *Pays off: Reliabuilder payment 3/4 · $43,987.50* — the line under a bill
 * that is about to land, offering the expected payment it looks like.
 *
 * **Ticked when it arrives, and a tap takes it back.** The household chose
 * that: a bill for an earmarked claim is nearly always that claim, and a line
 * they have to tick every time is a line that gets forgotten, which leaves the
 * Expected total counting the claim twice. Nothing is written until the bill
 * itself is saved, so an untick costs nothing.
 *
 * It says what the tick does in words, and says when the figures differ —
 * "$1,200 more than expected" — because the bill replaces the guess rather
 * than adding to it, and that is worth seeing before it happens. *Not this
 * one* steps to the next match and then to none.
 */
export default function PaysOffLine({ match, ticked, more, money, onToggle, onNext, style }: Props) {
  const expected = expectedAmountIncl(match.expected);
  const difference = match.difference !== null && match.difference > 0.005 && expected !== null
    ? match.difference
    : null;
  const title = `Pays off ${match.expected.name}${expected !== null ? ` · ${money(expected)}` : ''}`;
  const note = !ticked
    ? 'Stays on Expected to pay'
    : difference !== null
      ? `Takes it off Expected to pay · ${money(difference)} different from expected`
      : 'Takes it off Expected to pay';

  return (
    <View style={[styles.box, style]}>
      <Pressable
        onPress={onToggle}
        style={styles.tap}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked }}
        accessibilityLabel={title}
      >
        <Icon
          name={ticked ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={ticked ? Colors.primary : Colors.textMuted}
        />
        <View style={styles.body}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.note}>{note}</Text>
        </View>
      </Pressable>
      {more || ticked ? (
        <Pressable
          onPress={onNext}
          style={styles.next}
          accessibilityRole="button"
          accessibilityLabel="Not this one"
        >
          <Text style={styles.nextLabel}>Not this one</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The state behind one *Pays off* line: which match is shown and whether it is
 * ticked. The best match arrives ticked; *Not this one* steps to the next,
 * ticked, and after the last to none. A new set of matches — the supplier or
 * the amount changed — starts again from the best.
 */
export function usePaysOff(matches: ExpectedMatch[]) {
  const key = matches.map((m) => m.expected.id).join(',');
  const [shown, setShown] = useState(0);
  const [ticked, setTicked] = useState(matches.length > 0);
  useEffect(() => {
    setShown(0);
    setTicked(matches.length > 0);
  }, [key]);

  const match = matches[Math.min(shown, matches.length - 1)] ?? null;
  return {
    match,
    ticked: match !== null && ticked,
    more: shown + 1 < matches.length,
    /** The expectation saving will pay off, or null for none. */
    chosen: match !== null && ticked ? match.expected : null,
    toggle: () => setTicked((t) => !t),
    next: () => {
      if (shown + 1 < matches.length) {
        setShown(shown + 1);
        setTicked(true);
      } else {
        setTicked(false);
      }
    },
  };
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs,
  },
  tap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: MIN_TOUCH_TARGET },
  body: { flex: 1, minWidth: 0, gap: 2, paddingVertical: Spacing.xs },
  title: { fontSize: Typography.body, lineHeight: 22, color: Colors.textPrimary },
  note: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textMuted },
  next: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start', paddingLeft: 22 + Spacing.md },
  nextLabel: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.primary },
});
