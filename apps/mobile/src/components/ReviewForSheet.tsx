import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from './Text';

import Sheet from './Sheet';
import { Group, RadioRow, SectionTitle } from './Grouped';
import { Colors, Typography } from '../constants/theme';
import { businessKey, formatMoney } from '@snag/supabase-queries';
import type { InvoiceReview, ProjectElement, ProjectQuote } from '../types';

/** What a waiting bill is for: a quote it is a stage of, or an area of the job with no quote. */
export type ReviewFor = { quoteId: string } | { elementId: string | null };

interface Props {
  visible: boolean;
  review: InvoiceReview | null;
  /** Every price on the job; the quotes not turned down are offered. */
  quotes: ProjectQuote[];
  elements: ProjectElement[];
  /** The quote the card is going to now — chosen, or offered from its words. */
  current: ProjectQuote | null;
  /** The quote its words name, marked as such. */
  suggested: ProjectQuote | null;
  /** Areas its words name, marked as such. */
  suggestedAreas: string[];
  /** Writes the choice. A throw keeps the sheet open and says why. */
  onPick: (choice: ReviewFor) => Promise<void>;
  onClose: () => void;
}

/**
 * *For ▾* on a waiting card: one list, two halves.
 *
 * **Part of a quote** — the bill is a stage of that price (a deposit, a
 * progress claim). It lands where the quote sits, linked, so a signed price
 * counts it once. Only a bill can be one; a quote card is offered the areas.
 * **On its own** — no quote; the bill goes on the whole job or an area and
 * counts by itself. Either half is one press that writes and closes, the
 * app's rule for a tap, and the card says the answer on its *For* line.
 *
 * It replaced a ticked box under the card offering the one quote the bill's
 * words named: a quote the words did not name could not be chosen there, and
 * the box was most of the card. A split between several rooms is still made
 * with the pencil; here it shows as the current answer.
 */
export default function ReviewForSheet({
  visible, review, quotes, elements, current, suggested, suggestedAreas, onPick, onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setBusy(false);
    setError(null);
  }, [visible]);

  if (!review) return null;

  const key = businessKey(review.supplier);
  const offered = review.kind === 'invoice'
    ? quotes
      .filter((q) => q.kind === 'quote' && q.status !== 'declined')
      .sort((a, b) => Number(businessKey(b.supplier) === key) - Number(businessKey(a.supplier) === key))
    : [];
  const areas = elements.filter((e) => !e.implicit);
  const shared = !current && review.roomIds.length > 1;
  const onArea = !current && !shared;

  async function pick(choice: ReviewFor, already: boolean) {
    if (busy) return;
    if (already) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      await onPick(choice);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="What’s it for?" subtitle={review.supplier} onClose={onClose}>
      {offered.length > 0 ? (
        <>
          <SectionTitle title="Part of a quote" />
          <Group>
            {offered.map((q) => (
              <RadioRow
                key={q.id}
                title={[q.invoiceNumber, q.detail ?? 'A quote'].filter(Boolean).join(' · ')}
                subtitle={[
                  q.supplier,
                  formatMoney(q.amountIncl),
                  q.status === 'accepted' ? 'agreed' : 'not agreed yet',
                  suggested?.id === q.id ? 'its words say so' : null,
                ].filter(Boolean).join(' · ')}
                selected={current?.id === q.id}
                onPress={() => pick({ quoteId: q.id }, current?.id === q.id)}
              />
            ))}
          </Group>
        </>
      ) : null}
      <SectionTitle title={offered.length > 0 ? 'On its own' : 'Where it goes'} />
      <Group>
        {shared ? (
          <RadioRow title="Shared between rooms" subtitle="Change the split with the pencil" selected onPress={onClose} />
        ) : null}
        <RadioRow
          title="Whole job"
          selected={onArea && !review.elementId}
          onPress={() => pick({ elementId: null }, onArea && !review.elementId)}
        />
        {areas.map((e) => (
          <RadioRow
            key={e.id}
            title={e.room ?? e.name}
            subtitle={suggestedAreas.includes(e.id) ? 'its words name it' : null}
            selected={onArea && review.elementId === e.id}
            onPress={() => pick({ elementId: e.id }, onArea && review.elementId === e.id)}
          />
        ))}
      </Group>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
});
