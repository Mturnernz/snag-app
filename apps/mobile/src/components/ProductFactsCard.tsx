import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

import { Group, Pill, Row, SectionTitle, TextButton } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';
import {
  describeCycle, monthsToDays, productOffers, type ProductFacts, type ProductLookup,
} from '@snag/supabase-queries';
import type { Thing } from '../types';

/**
 * What the maker's own website says about this model: the manual, the parts a
 * householder replaces, and how often it should be serviced.
 *
 * **Only what could be checked, and each with where it says so.** The label
 * reader used to suggest parts from the model's memory, and four scans of one
 * heat pump gave three different answers — two with part numbers that were not
 * this heat pump's. `lookup-product` searches instead, opens every page the
 * answer cites, and keeps a value only if the maker's own page states it for
 * this model. So every row here opens the page it came from, and a lookup
 * that could confirm nothing says exactly that rather than offering something
 * vaguer. "Air cleaning filter" with no number is not an answer.
 *
 * **Looked up once per model.** A second scan, or a second unit of the same
 * model, shows the same answer. *Try again* is offered only when the lookup
 * failed — never on *nothing found*, which is an answer, and asking again
 * until something turns up is how one model gets two answers.
 *
 * Offers, never writes: a part is added to the thing's list with *Add*, the
 * interval opens *Schedule service* already set. The screen does the writes.
 */

interface Props {
  thing: Thing;
  lookup: ProductLookup | null;
  /** A lookup this page asked for, still on its way. */
  looking: boolean;
  busy: boolean;
  onLookUp: (again: boolean) => void;
  onOpen: (url: string) => void;
  onAddPart: (part: ProductFacts['parts'][number]) => void;
  onService: (days: number) => void;
}

const FAILED_WORDS: Record<NonNullable<ProductLookup['reason']>, string> = {
  busy: 'The search was busy when this was looked up.',
  quota: "That day's reads were used up when this was looked up.",
  error: "Couldn't finish looking this up.",
};

export default function ProductFactsCard({
  thing, lookup, looking, busy, onLookUp, onOpen, onAddPart, onService,
}: Props) {
  const make = thing.make?.trim() ?? '';
  const model = thing.model?.trim() ?? '';
  if (!make || !model) return null;
  const title = `What ${make} says`;

  if (looking || lookup?.status === 'pending') {
    return (
      <View style={styles.block}>
        <SectionTitle title={title} />
        <Group>
          <View style={styles.pending}>
            <ActivityIndicator size="small" color={Colors.textMuted} />
            <Text style={styles.caption}>
              {`Looking on ${make}'s own website and checking what it finds — this can take a minute.`}
            </Text>
          </View>
        </Group>
      </View>
    );
  }

  if (!lookup) {
    return (
      <View style={styles.block}>
        <SectionTitle title={title} />
        <Group>
          <Row
            title="Manual, parts and servicing"
            subtitle={`Only what ${make}'s own website says for the ${model}`}
            accessory={
              <Pill
                label="Look it up"
                onPress={() => onLookUp(false)}
                disabled={busy}
                accessibilityLabel={`Look up the ${model} on ${make}'s website`}
              />
            }
          />
        </Group>
      </View>
    );
  }

  if (lookup.status === 'failed') {
    return (
      <View style={styles.block}>
        <SectionTitle title={title} />
        <Group>
          <View style={styles.body}>
            <Text style={styles.caption}>{FAILED_WORDS[lookup.reason ?? 'error']}</Text>
          </View>
          <View style={styles.actions}>
            <TextButton label="Try again" onPress={() => onLookUp(true)} bold accessibilityLabel="Look it up again" />
          </View>
        </Group>
      </View>
    );
  }

  if (lookup.status === 'nothing' || !lookup.facts) {
    return (
      <View style={styles.block}>
        <SectionTitle title={title} />
        <Group>
          <View style={styles.body}>
            <Text style={styles.caption}>
              {`Nothing for the ${model} could be confirmed on ${make}'s own website, so nothing is suggested.`}
            </Text>
          </View>
        </Group>
      </View>
    );
  }

  const facts = lookup.facts;
  const offers = productOffers(thing, facts);

  return (
    <View style={styles.block}>
      <SectionTitle title={title} />
      <Group>
        {facts.manual ? (
          <Row
            title="Manual"
            subtitle={facts.manual.source}
            onPress={() => onOpen(facts.manual!.url)}
            accessibilityLabel={`Open the manual on ${facts.manual.source}`}
          />
        ) : null}
        {facts.service ? (
          <Row
            title={`Serviced every ${describeCycle(monthsToDays(facts.service.months))}`}
            subtitle={`“${facts.service.quote}” · ${facts.service.source}`}
            onPress={() => onOpen(facts.service!.url)}
            accessibilityLabel={`Where ${make} says so, on ${facts.service.source}`}
            accessory={
              offers.service ? (
                <Pill
                  label="Schedule"
                  onPress={() => onService(offers.service!.days)}
                  disabled={busy}
                  accessibilityLabel={`Schedule a service every ${describeCycle(offers.service.days)}`}
                />
              ) : undefined
            }
          />
        ) : null}
        {facts.parts.map((part) => {
          const taken = offers.taken.includes(part);
          return (
            <Row
              key={part.code}
              title={part.item}
              subtitle={`${part.code} · ${taken ? 'on its list' : part.source}`}
              onPress={() => onOpen(part.url)}
              accessibilityLabel={`Where ${make} lists ${part.code}, on ${part.source}`}
              accessory={
                taken ? undefined : (
                  <Pill
                    label="Add"
                    onPress={() => onAddPart(part)}
                    disabled={busy}
                    accessibilityLabel={`Add ${part.item} ${part.code}`}
                  />
                )
              }
            />
          );
        })}
      </Group>
      {/* A fact the reader can check, which is the only kind of line this
          app allows under a section: every row opens where it says so. */}
      <Text style={styles.note}>
        {`Each one is written on ${make}'s own website for this model — tap it to see where.`}
      </Text>
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
  note: {
    fontSize: Typography.footnote,
    lineHeight: 18,
    color: Colors.textMuted,
    paddingHorizontal: 4,
  },
});
