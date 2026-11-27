import React, { useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from '../components/Text';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import AddPriceSheet from '../components/AddPriceSheet';
import BillSheet from '../components/BillSheet';
import { Group, Pill, Row, Segmented, groupedStyles } from '../components/Grouped';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import { useHousehold } from '../hooks/useHousehold';
import { useProjectMoney } from '../hooks/useProjectMoney';
import { SupplierCard } from './ProjectScreen';
import { billOutstanding, formatExactDate, formatMoney } from '@snag/supabase-queries';
import type { ProjectQuote, RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ProjectSupplier'>;

const money = (n: number | null) => (n === null ? '—' : formatMoney(n) ?? '—');

/**
 * One supplier on a project: their figures, then their invoices and their
 * quotes, one tab each. A finished project shows invoices only — quotes are
 * history nobody opens a finished job to compare.
 */
export default function SupplierScreen({ route }: Props) {
  const { projectId, supplierKey } = route.params;
  const navigation = useNavigation();
  const insets = useEdgeInsets();
  const { household } = useHousehold();
  const m = useProjectMoney(projectId);
  const [tab, setTab] = useState<'invoices' | 'quotes'>('invoices');
  const [open, setOpen] = useState<ProjectQuote | null>(null);
  const [adding, setAdding] = useState(false);

  const supplier = m.ledger?.suppliers.find((s) => s.key === supplierKey) ?? null;
  const done = m.project?.status === 'done';
  const showing = done ? 'invoices' : tab;

  return (
    <View style={groupedStyles.screen}>
      <View style={[styles.nav, { paddingTop: insets.top + Spacing.xs }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back to the project"
        >
          <Icon name="chevron-back" size={24} color={Colors.primary} />
          <Text style={styles.backLabel} numberOfLines={1}>{m.project?.name ?? 'Project'}</Text>
        </Pressable>
        <Pressable
          onPress={() => setAdding(true)}
          style={styles.addTap}
          accessibilityRole="button"
          accessibilityLabel="Add a quote or invoice from this supplier"
        >
          <View style={styles.addDisc}>
            <Icon name="add" size={22} color={Colors.white} />
          </View>
        </Pressable>
      </View>

      {!m.ledger ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>
      ) : !supplier ? (
        <View style={styles.loading}><Text style={groupedStyles.caption}>Nothing from this supplier now.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title} accessibilityRole="header">{supplier.name ?? 'No supplier'}</Text>
          <SupplierCard supplier={supplier} />

          {done ? null : (
            <Segmented
              options={[
                { value: 'invoices', label: `Invoices · ${supplier.invoices.length}` },
                { value: 'quotes', label: `Quotes · ${supplier.quotes.length}` },
              ]}
              value={tab}
              onChange={setTab}
              accessibilityLabel="Invoices or quotes"
            />
          )}

          {showing === 'invoices' ? (
            supplier.invoices.length === 0 ? (
              <Text style={groupedStyles.hint}>No invoices yet.</Text>
            ) : (
              <Group>
                {supplier.invoices.map((q) => {
                  const owing = billOutstanding(q);
                  return (
                    <Row
                      key={q.id}
                      title={q.invoiceNumber ?? 'Invoice'}
                      subtitle={[
                        q.dated ? formatExactDate(q.dated) : null,
                        q.billedThroughId ? 'Included in another invoice' : owing > 0.005 ? `${money(owing)} owing` : 'Paid',
                      ].filter(Boolean).join(' · ')}
                      value={money(q.amountIncl)}
                      tone={owing > 0.005 && !q.billedThroughId ? 'danger' : 'default'}
                      onPress={() => setOpen(q)}
                    />
                  );
                })}
              </Group>
            )
          ) : supplier.quotes.length === 0 ? (
            <Text style={groupedStyles.hint}>No quotes from them.</Text>
          ) : (
            <Group>
              {supplier.quotes.map((q) => (
                <Row
                  key={q.id}
                  title={q.invoiceNumber ?? 'Quote'}
                  subtitle={q.dated ? formatExactDate(q.dated) : null}
                  value={money(q.amountIncl)}
                  dim={q.status === 'declined'}
                  onPress={() => setOpen(q)}
                  accessory={q.status === 'accepted'
                    ? <Text style={styles.accepted}>Accepted</Text>
                    : q.status === 'tbc'
                      ? <Pill label="Accept" onPress={() => m.accept(q)} accessibilityLabel={`Accept ${q.invoiceNumber ?? 'this quote'}`} />
                      : undefined}
                />
              ))}
            </Group>
          )}
        </ScrollView>
      )}

      <AddPriceSheet
        visible={adding}
        defaultKind={showing === 'quotes' ? 'quote' : 'invoice'}
        defaultSupplier={supplier?.name}
        prices={m.prices}
        knownSuppliers={m.suppliers}
        onClose={() => setAdding(false)}
        onSave={async (input) => { if (await m.add(input)) setAdding(false); }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm, backgroundColor: Colors.background,
  },
  back: {
    flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH_TARGET,
    paddingRight: Spacing.md, paddingLeft: Spacing.xs, flexShrink: 1,
  },
  backLabel: { fontSize: Typography.body, color: Colors.primary, flexShrink: 1 },
  addTap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  addDisc: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl * 2, gap: Spacing.xl },
  title: {
    fontSize: Typography.largeTitle, lineHeight: 41, fontWeight: Typography.bold,
    color: Colors.textPrimary, letterSpacing: -0.4, paddingHorizontal: 4,
  },
  accepted: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.textMuted, paddingLeft: Spacing.sm },
});
