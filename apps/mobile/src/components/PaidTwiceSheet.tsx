import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import Sheet from './Sheet';
import Button from './Button';
import { PriceFacts, cardFacts, type LookAlikeContext } from './LookAlikeSheet';
import { Colors, Fonts, Radius, Spacing, Typography } from '../constants/theme';
import { formatExactDate, formatMoney, inclGst, type PaymentEcho } from '@snag/supabase-queries';
import type { ProjectQuote } from '../types';

interface Props {
  visible: boolean;
  /** A payment on one bill that is exactly another bill from the same business. */
  echo: PaymentEcho | null;
  context: LookAlikeContext;
  /** Puts the twin inside the bill, so it counts once. A throw keeps the sheet open and says why. */
  onDeposit: (echo: PaymentEcho) => Promise<void>;
  /** Keeps both for the household, so the question stops. */
  onTwoBills: (echo: PaymentEcho) => Promise<void>;
  onClose: () => void;
}

/**
 * A bill beside another bill that looks like its deposit, to say which.
 *
 * *Worth checking* says *V3 looks like INV-15879's deposit · Paid twice*:
 * INV-15879 carries a payment of $8,244.11, and V3, for exactly $8,244.11 from
 * the same business, is on the job as its own paid invoice. The row used to
 * open V3 alone, which showed one side of the question. Here both are cards,
 * the bill first, each listing its payments, with the matching figure in bold:
 * the payment on the bill and the twin's own amount.
 *
 * Two answers, by the owner's decision:
 *
 * - **It's the deposit** puts the twin inside the bill (`billed_through_id`,
 *   what *Part of → Included in* writes), so it leaves Invoiced and Paid and
 *   counts once. Its paperwork stays on the job, which deleting it would not.
 * - **Two bills** keeps the pair for the household (`keep_both_prices`, the
 *   look-alike table), so neither phone asks again.
 *
 * Both cards are on screen at once and the answers are in the footer, because
 * the question is about the pair, not either card: no swipe here.
 */
export default function PaidTwiceSheet({
  visible, echo, context, onDeposit, onTwoBills, onClose,
}: Props) {
  const [busy, setBusy] = useState<'deposit' | 'two' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setBusy(null);
      setError(null);
    }
    wasVisible.current = visible;
  }, [visible]);

  async function answer(which: 'deposit' | 'two') {
    if (!echo || busy) return;
    setBusy(which);
    setError(null);
    try {
      await (which === 'deposit' ? onDeposit(echo) : onTwoBills(echo));
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That wasn’t saved');
    } finally {
      setBusy(null);
    }
  }

  const figure = echo ? formatMoney(inclGst(echo.payment.amount, echo.payment.amountInclGst)) ?? '' : '';

  return (
    <Sheet
      visible={visible && echo !== null}
      title="Paid twice"
      subtitle={echo ? [echo.bill.supplier, figure].filter(Boolean).join(' · ') : null}
      onClose={onClose}
      footer={echo ? (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                label="Two bills"
                variant="outline"
                onPress={() => answer('two')}
                loading={busy === 'two'}
                disabled={busy !== null}
              />
            </View>
            <View style={styles.action}>
              <Button
                label="It’s the deposit"
                onPress={() => answer('deposit')}
                loading={busy === 'deposit'}
                disabled={busy !== null}
              />
            </View>
          </View>
        </>
      ) : null}
    >
      {echo ? (
        <View style={styles.cards}>
          <Card price={echo.bill} match={echo.payment.id} context={context} />
          <Card price={echo.twin} amountMatches context={context} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** One price, its facts, and its payments, with what matches in bold. */
function Card({
  price, match, amountMatches = false, context,
}: {
  price: ProjectQuote;
  /** The payment that is the other bill's figure. */
  match?: string;
  /** Whether this price's own figure is the payment on the other. */
  amountMatches?: boolean;
  context: LookAlikeContext;
}) {
  const payments = context.payments.filter((p) => p.quoteId === price.id);
  return (
    <View style={styles.card} testID={`paid-twice-card-${price.id}`}>
      <PriceFacts
        price={price}
        facts={cardFacts(price, context)}
        bold={amountMatches ? new Set(['amount']) : new Set()}
      >
        {payments.length > 0 ? (
          <View style={styles.payments}>
            <Text style={styles.label}>Payments</Text>
            {payments.map((p) => {
              const on = p.id === match;
              const words = [formatExactDate(p.paidOn) || 'No date', p.reference].filter(Boolean).join(' · ');
              const amount = formatMoney(inclGst(p.amount, p.amountInclGst)) ?? '';
              return (
                <View
                  key={p.id}
                  style={styles.payment}
                  accessible
                  accessibilityLabel={`Payment ${words}, ${amount}${on ? ', the same figure' : ''}`}
                >
                  <Text style={[styles.paymentWords, on && styles.bold]}>{words}</Text>
                  <Text style={[styles.paymentFigure, on && styles.bold]}>{amount}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </PriceFacts>
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { gap: Spacing.md },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  payments: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.separator,
  },
  label: { fontFamily: Fonts.mono, fontSize: Typography.xs, color: Colors.textMuted },
  payment: { flexDirection: 'row', gap: Spacing.md },
  paymentWords: { flex: 1, minWidth: 0, fontSize: Typography.base, color: Colors.textSecondary },
  paymentFigure: {
    flexShrink: 0, fontSize: Typography.base, color: Colors.textSecondary, fontVariant: ['tabular-nums'],
  },
  bold: { color: Colors.textPrimary, fontWeight: Typography.bold },
  error: { fontSize: Typography.sm, color: Colors.danger },
  actions: { flexDirection: 'row', gap: Spacing.md },
  action: { flex: 1 },
});
