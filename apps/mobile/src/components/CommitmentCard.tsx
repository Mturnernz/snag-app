import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import Icon from './Icon';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  describeAllowance, describeBuildUp, formatLooseDate, formatMoney, inclGst, milestoneAmount,
  outstanding,
} from '@snag/supabase-queries';
import {
  ProjectMilestone, ProjectQuote, ProjectQuoteStatus, ProjectSupplierTotals,
} from '../types';

interface Props {
  supplier: ProjectSupplierTotals;
  /** Everything this supplier has sent — contracts and bills alike. */
  prices: ProjectQuote[];
  milestones: ProjectMilestone[];
  onSign: (quoteId: string, status: ProjectQuoteStatus) => void;
  onOpenBuildUp: (quote: ProjectQuote) => void;
  onOpenSchedule: (quote: ProjectQuote) => void;
  onOpenPrice: (quote: ProjectQuote) => void;
}

/**
 * One supplier, and what the household owes them.
 *
 * **This is the section that did not exist, and its absence is what bent the
 * live job out of shape.** Money arrives by vendor and contract; scope is by
 * room. With nowhere to put a contract, somebody invented a part called "Whole
 * job" holding five supplier accounts wearing items' clothes — including the
 * exact row the money spec named as the thing to avoid.
 *
 * **Signed, not accepted.** The status underneath is the same enum, but the word
 * is the fix for the single wrong number on the live page: ReliaBuilder's
 * $176,755 sat at `tbc` for five months, so Committed read $103,574 against a
 * $187,000 budget when the truth was $192,354 — nearly $89,000 of headroom that
 * did not exist. *Accepted / TBC / Declined* is the vocabulary of comparing
 * three prices for a toilet. Nobody looks at a contract they signed in March and
 * thinks "I should mark that accepted", and the control was six levels deep
 * besides. Here it is two, and it asks the question a householder can answer
 * without looking anything up.
 *
 * Comparing prices for one item keeps *Accepted / Declined* on the item sheet —
 * those are genuinely different moments and they should stop sharing a control.
 */
export default function CommitmentCard({
  supplier, prices, milestones, onSign, onOpenBuildUp, onOpenSchedule, onOpenPrice,
}: Props) {
  const still = outstanding({
    committedTotal: supplier.committed,
    paidTotal: supplier.paid,
  });
  const settled = supplier.committed !== null && (still ?? 0) < 0.005;

  const contracts = prices.filter((price) => price.kind === 'quote');
  const bills = prices.filter((price) => price.kind === 'invoice');

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.titles}>
          <Text style={styles.name} numberOfLines={1}>
            {supplier.supplier ?? 'Nobody named'}
          </Text>
          <Text style={styles.under} numberOfLines={1}>
            {[
              supplier.committed !== null ? `committed ${formatMoney(supplier.committed)}` : null,
              supplier.invoiced !== null ? `invoiced ${formatMoney(supplier.invoiced)}` : null,
              supplier.paid !== null ? `paid ${formatMoney(supplier.paid)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {/* Absent at zero rather than drawn as $0 — the same rule as the
            shopping pill and *Fit* in the photo viewer. */}
        {settled ? (
          <View style={styles.settled}>
            <Text style={styles.settledLabel}>Settled</Text>
          </View>
        ) : (
          <View style={styles.money}>
            <Text style={styles.moneyKey}>OUTSTANDING</Text>
            <Text style={styles.moneyValue} numberOfLines={1}>
              {formatMoney(still) ?? '—'}
            </Text>
          </View>
        )}
      </View>

      {contracts.map((contract) => {
        const signed = contract.status === 'accepted';
        const declined = contract.status === 'declined';
        const schedule = milestones.filter((m) => m.quoteId === contract.id);
        const buildUp = describeBuildUp(contract);
        const soft = describeAllowance(contract);

        return (
          <View key={contract.id} style={[styles.price, declined && styles.declined]}>
            <Pressable
              onPress={() => onOpenPrice(contract)}
              style={styles.priceHead}
              accessibilityRole="button"
              accessibilityLabel={contract.detail ?? 'A price'}
            >
              <View style={styles.priceTitles}>
                <Text style={styles.priceName} numberOfLines={1}>
                  {contract.detail ?? 'A price'}
                </Text>
                <Text style={styles.priceSub} numberOfLines={1}>
                  {[
                    formatLooseDate(contract.dated) || null,
                    contract.basis === 'estimate' ? 'an estimate' : 'fixed price',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Text style={styles.priceAmount} numberOfLines={1}>
                {formatMoney(contract.amountIncl) ?? '—'}
              </Text>
            </Pressable>

            {/* Two named halves, and the reason the live total was wrong. */}
            <View style={styles.chips}>
              {([
                ['accepted', 'Signed'],
                ['tbc', 'Not yet'],
                ['declined', 'Turned down'],
              ] as [ProjectQuoteStatus, string][]).map(([option, label]) => {
                const on = contract.status === option;
                return (
                  <Pressable
                    key={option}
                    onPress={() => onSign(contract.id, option)}
                    style={styles.chipTap}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={label}
                  >
                    <View style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {buildUp || soft ? (
              <Text style={styles.buildUp}>
                {[buildUp, soft].filter(Boolean).join(' · ')}
              </Text>
            ) : null}

            {schedule.length > 0 ? (
              <View style={styles.schedule}>
                {schedule.map((milestone) => {
                  const due = milestoneAmount(milestone, contract.amountIncl);
                  const claimed = prices.some(
                    (price) => price.settlesMilestoneId === milestone.id
                  );
                  return (
                    <View key={milestone.id} style={styles.milestone}>
                      <Icon
                        name={claimed ? 'checkbox-outline' : 'square-outline'}
                        size="sm"
                        color={claimed ? Colors.primary : Colors.textMuted}
                      />
                      <Text style={styles.milestoneName} numberOfLines={1}>
                        {milestone.name}
                        {milestone.percent !== null ? ` · ${milestone.percent}%` : ''}
                      </Text>
                      <Text style={styles.milestoneAmount} numberOfLines={1}>
                        {formatMoney(due) ?? '—'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                onPress={() => onOpenBuildUp(contract)}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={`What's in ${contract.detail ?? 'this price'}`}
              >
                <Text style={styles.actionLabel}>
                  {contract.lineCount > 0
                    ? `What's in it · ${contract.lineCount}`
                    : "What's in it"}
                </Text>
              </Pressable>
              {signed ? (
                <Pressable
                  onPress={() => onOpenSchedule(contract)}
                  style={styles.action}
                  accessibilityRole="button"
                  accessibilityLabel="Payment schedule"
                >
                  <Text style={styles.actionLabel}>
                    {schedule.length > 0
                      ? `Schedule · ${schedule.length}`
                      : 'Payment schedule'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}

      {bills.map((bill) => {
        const owing = bill.unpaid ?? 0;
        const overdue =
          owing > 0.005 && bill.dueOn !== null && bill.dueOn < new Date().toISOString().slice(0, 10);
        return (
          <Pressable
            key={bill.id}
            onPress={() => onOpenPrice(bill)}
            style={styles.bill}
            accessibilityRole="button"
            accessibilityLabel={bill.detail ?? 'A bill'}
          >
            <View style={styles.priceTitles}>
              <Text style={styles.billName} numberOfLines={1}>
                {bill.detail ?? 'A bill'}
              </Text>
              <Text style={[styles.priceSub, overdue && styles.overdue]} numberOfLines={1}>
                {owing < 0.005
                  ? 'paid'
                  : bill.dueOn
                    ? `${formatMoney(owing)} ${overdue ? 'overdue' : 'due'} ${formatLooseDate(bill.dueOn)}`
                    : `${formatMoney(owing)} to pay`}
              </Text>
            </View>
            <Text style={styles.billAmount} numberOfLines={1}>
              {formatMoney(bill.amountIncl) ?? '—'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginBottom: Spacing.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  titles: { flex: 1, minWidth: 0 },
  name: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  under: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },
  money: { alignItems: 'flex-end', marginLeft: Spacing.sm },
  moneyKey: {
    fontSize: Typography.xs, color: Colors.textMuted,
    letterSpacing: 0.8, fontWeight: Typography.semibold,
  },
  moneyValue: {
    fontSize: Typography.base, fontFamily: Fonts.mono, color: Colors.textPrimary,
  },
  settled: {
    backgroundColor: Colors.sunken, borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, marginLeft: Spacing.sm,
  },
  settledLabel: { fontSize: Typography.xs, color: Colors.textSecondary },
  price: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    marginTop: Spacing.sm, paddingTop: Spacing.sm,
  },
  // A declined price leaves every total and stays on the record: what you were
  // quoted and by whom is what makes the next renovation's numbers credible.
  declined: { opacity: 0.62 },
  priceHead: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH_TARGET },
  priceTitles: { flex: 1, minWidth: 0 },
  priceName: { fontSize: Typography.base, color: Colors.textPrimary },
  priceSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },
  overdue: { color: Colors.danger },
  priceAmount: {
    fontSize: Typography.base, fontFamily: Fonts.mono, color: Colors.textPrimary,
    marginLeft: Spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: Spacing.sm },
  chip: {
    backgroundColor: Colors.sunken, borderRadius: Radius.chip,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.xs, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  buildUp: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: Spacing.xs },
  schedule: { marginTop: Spacing.sm },
  milestone: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 2 },
  milestoneName: { flex: 1, minWidth: 0, fontSize: Typography.sm, color: Colors.textSecondary },
  milestoneAmount: { fontSize: Typography.sm, fontFamily: Fonts.mono, color: Colors.textMuted },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xs },
  action: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  actionLabel: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.medium },
  bill: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.border,
    marginTop: Spacing.sm, paddingTop: Spacing.sm, minHeight: MIN_TOUCH_TARGET,
  },
  billName: { fontSize: Typography.sm, color: Colors.textSecondary },
  billAmount: {
    fontSize: Typography.sm, fontFamily: Fonts.mono, color: Colors.textSecondary,
    marginLeft: Spacing.sm,
  },
});
