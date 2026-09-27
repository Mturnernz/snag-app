import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

import { Group, Pill, Row, SectionTitle, TextButton } from './Grouped';
import { Colors, Fonts, Spacing, Typography } from '../constants/theme';
import { labelOffers, type LabelOffer, type LabelReadingToCheck } from '@snag/supabase-queries';
import type { Thing } from '../types';

/**
 * A label reading that landed after *Add it*, waiting to be checked.
 *
 * The walkthrough no longer waits on the read, so what the label says can
 * arrive after the thing exists. It is never written onto the record unseen —
 * the rule the label reader was built on — so it lands here instead, on the
 * thing's own page, as offers:
 *
 * - **Boxes the record left empty** fill together, in one write, with *Use
 *   these*. The same fill-only-empty rule the walkthrough follows.
 * - **Boxes where the label disagrees with what somebody typed** are each
 *   offered on their own, beside what the record says. The person may have
 *   mistyped; they are the only one who can say, so nothing is overwritten
 *   without a tap on that row.
 * - **Part numbers the label itself prints** are offered with a + each, since
 *   the thing's list is where somebody looks for them in a shop. What the
 *   maker says the model takes is not here — it is looked up and checked on
 *   the maker's own website, and shown under *What … says* (`ProductFactsCard`).
 *
 * A reading that came to nothing says why in words, and the ones a second go
 * could fix (busy, used up for the day, a failure) offer *Try again*.
 *
 * Presentational: the screen does the writes.
 */

interface Props {
  check: LabelReadingToCheck;
  thing: Thing;
  busy: boolean;
  retrying: boolean;
  onUse: (offers: LabelOffer[]) => void;
  onAddPart: (item: string) => void;
  onDismiss: () => void;
  onRetry: () => void;
}

const FAILED_WORDS: Record<NonNullable<LabelReadingToCheck['reason']>, string> = {
  illegible: "Couldn't make out the label in this photo — type the make and model from it.",
  busy: 'The label reader was busy when this was added.',
  quota: "That day's label reads were used up when this was added.",
  error: "Couldn't read the label when this was added.",
};

export default function LabelReadingCard({
  check, thing, busy, retrying, onUse, onAddPart, onDismiss, onRetry,
}: Props) {
  if (check.status === 'pending' || retrying) {
    return (
      <View style={styles.block}>
        <SectionTitle title="Label" />
        <Group>
          <View style={styles.pending}>
            <ActivityIndicator size="small" color={Colors.textMuted} />
            <Text style={styles.caption}>Still reading the label — check back in a minute.</Text>
          </View>
        </Group>
      </View>
    );
  }

  if (check.status === 'failed' || !check.reading) {
    const reason = check.reason ?? 'illegible';
    return (
      <View style={styles.block}>
        <SectionTitle title="Label" />
        <Group>
          <View style={styles.body}>
            <Text style={styles.caption}>{FAILED_WORDS[reason]}</Text>
          </View>
          <View style={styles.actions}>
            {reason !== 'illegible' ? (
              <TextButton label="Try again" onPress={onRetry} bold accessibilityLabel="Read the label again" />
            ) : null}
            <TextButton label="Dismiss" onPress={onDismiss} accessibilityLabel="Dismiss the label reading" />
          </View>
        </Group>
      </View>
    );
  }

  const offers = labelOffers(thing, check.reading);

  return (
    <View style={styles.block}>
      <SectionTitle title="Read from the label" />
      <Group>
        {offers.fill.map((one) => (
          <Row key={`fill-${one.key}`} title={one.label} value={one.value} />
        ))}
        {offers.fill.length ? (
          <View style={styles.actions}>
            <Pill
              label="Use these"
              onPress={() => onUse(offers.fill)}
              disabled={busy}
              accessibilityLabel="Use what the label says"
            />
          </View>
        ) : null}
        {offers.differ.map((one) => (
          <Row
            key={`differ-${one.key}`}
            title={`${one.label}: label says ${one.value}`}
            subtitle={`The record says ${one.current}`}
            accessory={
              <Pill
                label="Use"
                onPress={() => onUse([one])}
                disabled={busy}
                accessibilityLabel={`Use ${one.value} for ${one.label}`}
              />
            }
          />
        ))}
      </Group>

      {offers.parts.length ? (
        <>
          <Text style={styles.suggested}>Printed on the label</Text>
          <Group>
            {offers.parts.map((item) => (
              <Row
                key={`part-${item}`}
                title={item}
                accessory={
                  <Pill
                    label="Add"
                    onPress={() => onAddPart(item)}
                    disabled={busy}
                    accessibilityLabel={`Add ${item}`}
                  />
                }
              />
            ))}
          </Group>
        </>
      ) : null}

      <View style={styles.dismiss}>
        <TextButton label="Not right — dismiss" onPress={onDismiss} accessibilityLabel="Dismiss the label reading" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.sm },
  body: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  caption: { flex: 1, fontSize: Typography.subhead, lineHeight: 20, color: Colors.textMuted },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  suggested: {
    fontFamily: Fonts.mono,
    fontSize: Typography.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    paddingHorizontal: 4,
    marginTop: Spacing.xs,
  },
  dismiss: { alignItems: 'flex-start' },
});
