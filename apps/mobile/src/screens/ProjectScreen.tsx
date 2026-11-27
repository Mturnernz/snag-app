import React, { useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from '../components/Text';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import AddPriceSheet from '../components/AddPriceSheet';
import BillSheet from '../components/BillSheet';
import EditBudgetSheet from '../components/EditBudgetSheet';
import ProjectStatusSheet from '../components/ProjectStatusSheet';
import ProjectTitle from '../components/ProjectTitle';
import { Group, Pill, Row, SectionTitle, TextButton, groupedStyles } from '../components/Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import { useHousehold } from '../hooks/useHousehold';
import { useProjectMoney } from '../hooks/useProjectMoney';
import {
  describeDifference, describeQuoted, formatExactDate, formatLooseDate, formatMoney, inclGst,
  type LedgerSupplier,
} from '@snag/supabase-queries';
import {
  PROJECT_STATUS_LABELS, type InvoiceReview, type ProjectQuote, type ProjectStatus, type RootStackParamList,
} from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ProjectDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const money = (n: number) => formatMoney(n) ?? '';

/**
 * One project, the way Alyssa's wireframe reads it (November 2026).
 *
 * - **In progress**: the expected total, then budget, difference, paid and
 *   outstanding; then one card per supplier — Total, Paid, Outstanding, or
 *   just *Total (paid)* once nothing is owed.
 * - **Completed**: what it cost, and the suppliers.
 * - **Planned**: the budget and the quotes, each one tap from accepted —
 *   which starts the project.
 *
 * A supplier's card opens their quotes and invoices. The + adds either.
 * Emailed papers wait at the top until they are added or removed. Nothing
 * else: parts, rooms, allowances and the rest are still in the database and
 * not read here.
 */
export default function ProjectScreen({ route }: Props) {
  const { projectId } = route.params;
  const navigation = useNavigation<Nav>();
  const insets = useEdgeInsets();
  const { household } = useHousehold();
  const m = useProjectMoney(projectId);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<ProjectQuote | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);

  const { project, ledger } = m;

  if (!project || !ledger) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        {m.failed ? (
          <View style={styles.failed}>
            <Text style={groupedStyles.caption}>Couldn’t load this project.</Text>
            <TextButton label="Try again" onPress={m.reload} />
          </View>
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </View>
    );
  }

  const budget = inclGst(project.budget, project.budgetInclGst);
  const date = project.status === 'done' && project.finishedOn
    ? `Finished ${formatLooseDate(project.finishedOn)}`
    : project.startedOn ? `Started ${formatLooseDate(project.startedOn)}` : null;
  const quotes = m.prices.filter((q) => q.kind === 'quote' && q.status !== 'declined');
  const billed = ledger.suppliers.filter((s) => s.invoices.length > 0 || s.acceptedQuotes > 0);
  const showSuppliers = project.status !== 'planned' || billed.length > 0;
  const difference = ledger.difference !== null ? describeDifference(ledger.difference, money) : null;

  return (
    <View style={groupedStyles.screen}>
      <View style={[styles.nav, { paddingTop: insets.top + Spacing.xs }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back to projects"
        >
          <Icon name="chevron-back" size={24} color={Colors.primary} />
          <Text style={styles.backLabel}>Projects</Text>
        </Pressable>
        <Pressable
          onPress={() => setAdding(true)}
          style={styles.addTap}
          accessibilityRole="button"
          accessibilityLabel="Add a quote or invoice"
        >
          <View style={styles.addDisc}>
            <Icon name="add" size={22} color={Colors.white} />
          </View>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleBlock}>
          <ProjectTitle name={project.name} onRename={m.rename} />
          <View style={styles.statusLine}>
            <Pressable
              onPress={() => setStatusOpen(true)}
              style={styles.statusTap}
              accessibilityRole="button"
              accessibilityLabel={`${PROJECT_STATUS_LABELS[project.status]}. Change where it’s up to`}
            >
              <View style={[styles.statusPill, STATUS_TINT[project.status]]}>
                <Text style={[styles.statusLabel, { color: STATUS_INK[project.status] }]}>
                  {PROJECT_STATUS_LABELS[project.status]}
                </Text>
                <Icon name="chevron-down" size={14} color={STATUS_INK[project.status]} />
              </View>
            </Pressable>
            {date ? <Text style={groupedStyles.caption}>{date}</Text> : null}
          </View>
        </View>

        {m.reviews.length > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="New from email" count={m.reviews.length} />
            <Group>
              {m.reviews.map((r) => (
                <ReviewRow key={r.id} review={r} onKeep={() => m.keepReview(r)} onDrop={() => m.dropReview(r)} />
              ))}
            </Group>
          </View>
        ) : null}

        {/* The figures. */}
        <View style={styles.summary}>
          {project.status === 'planned' ? (
            <>
              <Figure label="Budget" value={budget ? money(budget) : 'Not set'} onPress={() => setBudgetOpen(true)} />
              <Figure label="Quoted" value={describeQuoted(ledger.quotedRange, money) ?? 'No quotes yet'} />
            </>
          ) : project.status === 'done' ? (
            <>
              <Text style={styles.bigLabel}>Cost</Text>
              <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>{money(ledger.paid)}</Text>
              {ledger.outstanding > 0.005 ? <Figure label="Still owing" value={money(ledger.outstanding)} danger /> : null}
            </>
          ) : (
            <>
              <Text style={styles.bigLabel}>Expected total</Text>
              <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>{money(ledger.expected)}</Text>
              <Figure label="Budget" value={budget ? money(budget) : 'Not set'} onPress={() => setBudgetOpen(true)} />
              {difference ? <Figure label="Difference" value={difference.text} danger={difference.over} /> : null}
              <Figure label="Paid" value={money(ledger.paid)} />
              {ledger.outstanding > 0.005 ? <Figure label="Outstanding" value={money(ledger.outstanding)} /> : null}
            </>
          )}
        </View>

        {project.status === 'planned' ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="Supplier quotes" count={quotes.length || undefined} />
            {quotes.length === 0 ? (
              <Text style={groupedStyles.hint}>Add the quotes you’ve got with the +, and accept one to start.</Text>
            ) : (
              <Group>
                {quotes.map((q) => (
                  <Row
                    key={q.id}
                    title={q.supplier ?? 'No supplier'}
                    subtitle={[q.invoiceNumber, q.dated ? formatExactDate(q.dated) : null].filter(Boolean).join(' · ') || null}
                    value={q.amountIncl !== null ? money(q.amountIncl) : '—'}
                    onPress={() => setOpen(q)}
                    accessory={q.status === 'accepted'
                      ? <Text style={styles.accepted}>Accepted</Text>
                      : <Pill label="Accept" onPress={() => m.accept(q)} accessibilityLabel={`Accept ${q.supplier ?? 'this'} quote`} />}
                  />
                ))}
              </Group>
            )}
          </View>
        ) : null}

        {showSuppliers ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="Suppliers" count={ledger.suppliers.length || undefined} />
            {ledger.suppliers.length === 0 ? (
              <Text style={groupedStyles.hint}>Nothing yet. The + adds a quote or an invoice.</Text>
            ) : (
              ledger.suppliers.map((s) => (
                <SupplierCard
                  key={s.key}
                  supplier={s}
                  onPress={() => navigation.navigate('ProjectSupplier', { projectId, supplierKey: s.key })}
                />
              ))
            )}
          </View>
        ) : null}
      </ScrollView>

      <AddPriceSheet
        visible={adding}
        defaultKind={project.status === 'planned' ? 'quote' : 'invoice'}
        prices={m.prices}
        knownSuppliers={m.suppliers}
        onClose={() => setAdding(false)}
        onSave={async (input) => {
          if (await m.add(input)) setAdding(false);
        }}
      />

      <BillSheet
        price={open}
        householdId={household.id}
        onClose={() => setOpen(null)}
        onAccept={async (q) => { if (await m.accept(q)) setOpen(null); }}
        onPay={async (q, day) => { if (await m.pay(q, day)) setOpen(null); }}
        onFiles={m.files}
        onDelete={async (q) => { if (await m.remove(q)) setOpen(null); }}
      />

      <ProjectStatusSheet
        visible={statusOpen}
        status={project.status}
        startedOn={project.startedOn}
        finishedOn={project.finishedOn}
        onClose={() => setStatusOpen(false)}
        onSave={async (update) => { await m.saveStatus(update); }}
      />

      <EditBudgetSheet
        visible={budgetOpen}
        budget={project.budget}
        budgetInclGst={project.budgetInclGst}
        onClose={() => setBudgetOpen(false)}
        onSave={async (amount, incl) => { await m.saveBudget(amount, incl); }}
      />
    </View>
  );
}

/** Label left, figure right; a figure never shrinks, the label gives way. */
function Figure({
  label, value, danger, onPress,
}: { label: string; value: string; danger?: boolean; onPress?: () => void }) {
  const body = (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, danger && styles.danger]} numberOfLines={1}>{value}</Text>
      {onPress ? <Icon name="pencil" size={14} color={Colors.textMuted} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${value}. Change it`}>
      {body}
    </Pressable>
  ) : body;
}

/**
 * One supplier: Total (what they've invoiced), Paid, Outstanding. Once nothing
 * is owed it is one line, *Total (paid)* (Alyssa's note on the wireframe). A
 * supplier who has only quoted says what was quoted or accepted instead.
 */
export function SupplierCard({ supplier: s, onPress }: { supplier: LedgerSupplier; onPress?: () => void }) {
  const lines: { label: string; value: string; danger?: boolean }[] = [];
  if (s.invoices.length === 0) {
    const live = s.quotes.filter((q) => q.status !== 'declined');
    lines.push(s.acceptedQuotes > 0
      ? { label: 'Accepted quote', value: money(s.acceptedQuotes) }
      : { label: live.length === 1 ? 'Quoted' : `${live.length} quotes`, value: live.length === 1 && live[0].amountIncl !== null ? money(live[0].amountIncl) : '' });
  } else if (s.outstanding > 0.005) {
    lines.push({ label: 'Total', value: money(s.invoiced) });
    lines.push({ label: 'Paid', value: money(s.paid) });
    lines.push({ label: 'Outstanding', value: money(s.outstanding), danger: true });
  } else {
    lines.push({ label: 'Total (paid)', value: money(s.invoiced) });
  }
  const body = (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardName} numberOfLines={2}>{s.name ?? 'No supplier'}</Text>
        {onPress ? <Icon name="chevron-forward" size={16} color={Colors.chevron} /> : null}
      </View>
      {lines.map((l) => (
        <View key={l.label} style={styles.figure}>
          <Text style={styles.figureLabel}>{l.label}</Text>
          <Text style={[styles.figureValue, l.danger && styles.danger]} numberOfLines={1}>{l.value}</Text>
        </View>
      ))}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={s.name ?? 'No supplier'}>
      {body}
    </Pressable>
  ) : body;
}

/** An emailed paper: who, how much, what kind — Add or Remove. */
function ReviewRow({ review, onKeep, onDrop }: { review: InvoiceReview; onKeep: () => void; onDrop: () => void }) {
  const kind = review.kind === 'quote' ? 'Quote' : review.kind === 'paperwork' ? 'Paperwork' : 'Invoice';
  const amount = review.amount !== null ? money(inclGst(review.amount, review.amountInclGst) ?? review.amount) : null;
  return (
    <View style={styles.review}>
      <View style={styles.reviewText}>
        <Text style={styles.reviewName} numberOfLines={1}>{review.supplier ?? review.sourceSubject ?? 'Emailed paper'}</Text>
        <Text style={groupedStyles.caption}>{[kind, review.invoiceNumber, amount].filter(Boolean).join(' · ')}</Text>
      </View>
      <TextButton label="Remove" onPress={onDrop} accessibilityLabel={`Remove ${kind.toLowerCase()} from ${review.supplier ?? 'email'}`} />
      <Pill label={review.kind === 'paperwork' ? 'File' : 'Add'} onPress={onKeep} accessibilityLabel={`Add ${kind.toLowerCase()} from ${review.supplier ?? 'email'}`} />
    </View>
  );
}

const STATUS_TINT: Record<ProjectStatus, { backgroundColor: string }> = {
  planned: { backgroundColor: Colors.status.openBg },
  underway: { backgroundColor: Colors.status.doingBg },
  done: { backgroundColor: Colors.status.doneBg },
};
const STATUS_INK: Record<ProjectStatus, string> = {
  planned: Colors.status.openFg,
  underway: Colors.status.doingFg,
  done: Colors.status.doneFg,
};

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  failed: { alignItems: 'center', gap: Spacing.sm },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm, backgroundColor: Colors.background,
  },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH_TARGET, paddingRight: Spacing.md, paddingLeft: Spacing.xs },
  backLabel: { fontSize: Typography.body, color: Colors.primary },
  addTap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  addDisc: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl * 2, gap: Spacing.xxl },
  titleBlock: { gap: 4, paddingHorizontal: 4 },
  statusLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Spacing.md },
  statusTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginVertical: -8 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 30,
    paddingLeft: Spacing.md, paddingRight: Spacing.sm + 2, borderRadius: Radius.pill,
  },
  statusLabel: { fontSize: Typography.subhead, fontWeight: Typography.semibold },
  summary: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingVertical: Spacing.lg, paddingHorizontal: Spacing.lg + 2, gap: Spacing.sm,
  },
  bigLabel: { fontSize: Typography.subhead, color: Colors.textMuted },
  big: {
    fontSize: 40, lineHeight: 46, fontWeight: Typography.bold, color: Colors.textPrimary,
    letterSpacing: -1, fontVariant: ['tabular-nums'], marginBottom: Spacing.xs,
  },
  figure: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 28 },
  figureLabel: { flex: 1, minWidth: 0, fontSize: Typography.subhead, color: Colors.textMuted },
  figureValue: { flexShrink: 0, fontSize: Typography.body, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  danger: { color: Colors.danger, fontWeight: Typography.semibold },
  accepted: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.textMuted, paddingLeft: Spacing.sm },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingHorizontal: Spacing.lg + 2, paddingVertical: Spacing.lg, gap: Spacing.xs,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xs },
  cardName: { flex: 1, minWidth: 0, fontSize: Typography.body, lineHeight: 22, fontWeight: Typography.semibold, color: Colors.textPrimary },
  review: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingLeft: Spacing.lg, paddingRight: Spacing.md, minHeight: 60,
  },
  reviewText: { flex: 1, minWidth: 0, gap: 2 },
  reviewName: { fontSize: Typography.body, color: Colors.textPrimary },
});
