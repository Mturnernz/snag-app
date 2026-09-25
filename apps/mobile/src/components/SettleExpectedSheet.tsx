import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import Sheet from './Sheet';
import { AddRow, Group, Pill, Row, SectionTitle, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';
import {
  billsForExpected, expectedAmountIncl, expectedPayee, formatExactDate, formatMoney,
} from '@snag/supabase-queries';
import type { ProjectExpectedCost, ProjectQuote } from '../types';

interface Props {
  /** The expected payment being paid off, or null while the sheet is shut. */
  expected: ProjectExpectedCost | null;
  quotes: ProjectQuote[];
  /** Every expectation on the job, so a bill already paying off one is not offered again. */
  all: ProjectExpectedCost[];
  onClose: () => void;
  /** Links the bill; the page re-reads and the expectation leaves *Expected to pay*. */
  onChoose: (bill: ProjectQuote) => Promise<void>;
  /** The bill has not been recorded yet: record it, filled in and already paying this off. */
  onRecord: () => void;
}

/**
 * *Which bill paid this?* — behind **Billed** on an expected payment.
 *
 * The bill may be on the job already, recorded before anybody thought to tick
 * the earmark off, so this offers the bills there: **the ones from the same
 * business within 10%, recorded since the money was earmarked, first**
 * (`billsForExpected`), then every other bill that could, newest first,
 * because the paper sometimes says what a name on the page does not. A bill
 * already paying off another earmark is never offered — one bill, one
 * expectation.
 *
 * **A tap on *This one* links it**, the way a tap writes everywhere outside a
 * form — a pill rather than a row with a chevron, because a chevron promises a
 * page and this is a choice. The bill's own sheet says *Pays off* and offers
 * **Undo**, so a wrong tap is one press from undone. *Record the bill* is for
 * the case where it is not on the job yet: the money sheet opens on it, filled
 * in, and saving it pays this off.
 */
export default function SettleExpectedSheet({ expected, quotes, all, onClose, onChoose, onRecord }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setBusy(null); setError(null); }, [expected?.id]);

  const { matches, others } = useMemo(
    () => (expected ? billsForExpected(expected, quotes, all) : { matches: [], others: [] }),
    [expected, quotes, all],
  );
  const amount = expected ? expectedAmountIncl(expected) : null;
  const payee = expected ? expectedPayee(expected, quotes) : null;

  async function choose(bill: ProjectQuote) {
    if (busy) return;
    setBusy(bill.id);
    setError(null);
    try {
      await onChoose(bill);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(null);
    }
  }

  // The figure leads the second line rather than taking a column: beside the
  // pill, a column squeezed the supplier to "RELIABUILD ER LIMITE…" on a phone.
  const billRow = (bill: ProjectQuote, difference: number | null) => {
    const figure = bill.amountIncl ?? bill.amount;
    return (
      <Row
        key={bill.id}
        title={bill.supplier ?? 'No supplier'}
        subtitle={[
          figure !== null ? formatMoney(figure) : 'No figure',
          difference !== null && difference > 0.005 ? `${formatMoney(difference)} different` : null,
          bill.invoiceNumber,
          bill.detail,
          bill.dated ? formatExactDate(bill.dated) : null,
        ].filter(Boolean).join(' · ')}
        dim={busy !== null && busy !== bill.id}
        accessory={(
          <Pill
            label="This one"
            disabled={busy !== null}
            accessibilityLabel={`Paid by ${bill.supplier ?? 'a bill'}${bill.invoiceNumber ? ` ${bill.invoiceNumber}` : ''}${figure !== null ? `, ${formatMoney(figure)}` : ''}`}
            onPress={() => choose(bill)}
          />
        )}
      />
    );
  };

  return (
    <Sheet
      visible={expected !== null}
      title="Which bill paid this?"
      subtitle={expected
        ? [expected.name, amount !== null ? formatMoney(amount) : 'No figure'].join(' · ')
        : null}
      onClose={onClose}
    >
      {matches.length > 0 ? (
        <>
          <SectionTitle title={payee ? `From ${payee}` : 'Looks like it'} />
          <Group>{matches.map((m) => billRow(m.quote, m.difference))}</Group>
        </>
      ) : (
        <Text style={groupedStyles.hint}>
          {payee
            ? `No bill from ${payee} within 10% of it on the job yet.`
            : 'No bill on the job looks like it yet.'}
        </Text>
      )}

      <Group>
        <AddRow label="Record the bill" onPress={onRecord} />
      </Group>

      {others.length > 0 ? (
        <>
          <SectionTitle title={matches.length > 0 ? 'Another bill' : 'A bill on the job'} />
          <Group>{others.map((bill) => billRow(bill, null))}</Group>
        </>
      ) : null}

      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: Spacing.xs },
});
