import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import Sheet from './Sheet';
import { Group, PrimaryButton, RadioRow, SectionTitle, groupedStyles } from './Grouped';
import FileTagChips from './FileTagChips';
import { Colors, Spacing, Typography } from '../constants/theme';
import { documentName, formatLooseDate, formatMoney, guessFileTag, invoiceReviewHeadline, paperworkHomes } from '@snag/supabase-queries';
import { FILE_TAG_LABELS, type FileTag } from '@snag/shared-types';
import type { InvoiceReview, ProjectElement, ProjectQuote } from '../types';

/** Where it goes: a bill, a part, or — with neither — the job itself. */
export interface PaperworkHome {
  quoteId: string | null;
  elementId: string | null;
}

interface Props {
  review: InvoiceReview | null;
  quotes: ProjectQuote[];
  elements: ProjectElement[];
  onClose: () => void;
  /** Where it goes, and what its PDFs are — `null` leaves them untagged. */
  onFile: (where: PaperworkHome, tag: FileTag | null) => Promise<void>;
}

const key = (home: PaperworkHome) => home.quoteId ?? home.elementId ?? 'job';

/**
 * Filing a piece of paperwork that came in by email.
 *
 * **Filing is not allocating.** A certificate of compliance, the photos of the
 * deck, a plumber's variation made out to the builder: none of them is a price
 * the household owes, and each one recorded as a bill would be money counted
 * twice or money invented. So this asks only *where it belongs* and writes only
 * files — onto a bill, a part of the job, or the job — through
 * `file_review_paperwork`, which moves no figure.
 *
 * **The bill from the same business comes first**, marked as the suggestion:
 * the electrician's certificate goes with the electrician's invoice, and a
 * subcontractor's variation made out to the builder goes with the builder's.
 * It is chosen already when there is one, because that is nearly always the
 * answer; the job itself is chosen otherwise, because it is never wrong, only
 * less specific. Every other bill is below, so the suggestion is an offer and
 * never a fence.
 *
 * **It also asks what the paper is**, because this is the one moment the
 * answer is in front of somebody. The card's own words and filenames suggest
 * it (`guessFileTag` — "Certificate of Compliance" is a compliance
 * certificate), lit already and marked as a suggestion; pressing it again
 * leaves the paper untagged, and nothing is tagged on a sheet walked away from. A card with no
 * PDF is not asked: a photo of the deck is not a certificate.
 */
export default function FilePaperworkSheet({ review, quotes, elements, onClose, onFile }: Props) {
  const homes = useMemo(() => (review ? paperworkHomes(review, quotes) : { suggested: [], others: [] }), [review, quotes]);
  const parts = elements.filter((e) => !e.implicit);
  const [chosen, setChosen] = useState<PaperworkHome>({ quoteId: null, elementId: null });
  const [tag, setTag] = useState<FileTag | 'none'>('none');
  const [guessed, setGuessed] = useState(false);
  const hasDocuments = (review?.documentPaths.length ?? 0) > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!review) return;
    const first = homes.suggested[0];
    setChosen({ quoteId: first?.id ?? null, elementId: null });
    const guess = guessFileTag(review.detail, review.category, ...review.documentPaths.map(documentName));
    setTag(guess ?? 'none');
    setGuessed(guess !== null);
    setBusy(false);
    setError(null);
  }, [review?.id]);

  async function file() {
    if (!review || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onFile(chosen, hasDocuments && tag !== 'none' ? tag : null);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t file');
    } finally {
      setBusy(false);
    }
  }

  const billRow = (quote: ProjectQuote) => (
    <RadioRow
      key={quote.id}
      title={[quote.supplier ?? 'No supplier', quote.invoiceNumber].filter(Boolean).join(' · ')}
      subtitle={[
        quote.kind === 'quote' ? 'Quote' : 'Bill',
        quote.amount !== null ? formatMoney(quote.amount) : null,
        quote.dated ? formatLooseDate(quote.dated) : null,
      ].filter(Boolean).join(' · ')}
      selected={key(chosen) === quote.id}
      onPress={() => setChosen({ quoteId: quote.id, elementId: null })}
    />
  );

  return (
    <Sheet
      visible={review !== null}
      title="Where does it go?"
      subtitle={review ? invoiceReviewHeadline(review) : null}
      onClose={onClose}
      footer={<PrimaryButton label="File it" onPress={file} busy={busy} />}
    >
      {hasDocuments ? (
        <>
          <SectionTitle title="What is it?" />
          <FileTagChips
            accessibilityLabel="What this paper is"
            value={tag === 'none' ? null : tag}
            onChange={(next) => { setTag(next ?? 'none'); setGuessed(false); }}
          />
          {guessed && tag !== 'none' ? (
            <Text style={groupedStyles.hint}>Suggested from its title: {FILE_TAG_LABELS[tag]}</Text>
          ) : null}
        </>
      ) : null}

      {homes.suggested.length > 0 ? (
        <>
          <SectionTitle title="With the bill it’s about" />
          <Group>{homes.suggested.map(billRow)}</Group>
        </>
      ) : null}

      <SectionTitle title="On the job" />
      <Group>
        <RadioRow
          title="The whole job"
          selected={key(chosen) === 'job'}
          onPress={() => setChosen({ quoteId: null, elementId: null })}
        />
        {parts.map((part) => (
          <RadioRow
            key={part.id}
            title={part.name}
            selected={key(chosen) === part.id}
            onPress={() => setChosen({ quoteId: null, elementId: part.id })}
          />
        ))}
      </Group>

      {homes.others.length > 0 ? (
        <>
          <SectionTitle title={homes.suggested.length > 0 ? 'Another bill' : 'With a bill'} />
          <Group>{homes.others.map(billRow)}</Group>
        </>
      ) : null}

      <Text style={groupedStyles.hint}>It goes with the job’s paperwork. No figure changes.</Text>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: Spacing.xs },
});
