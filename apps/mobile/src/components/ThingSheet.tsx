import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import Icon from './Icon';
import Sheet from './Sheet';
import {
  AddRow, Group, Pill, PrimaryButton, RadioRow, Row, Segmented, TextButton, groupedStyles,
} from './Grouped';
import ConfirmDialog from './ConfirmDialog';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import {
  chooseOption, chosenAgainst, deleteItem, deleteStoredFiles, formatMoney, setItemExcluded,
  setItemSetAside, setQuoteStatus, updateItem, updateQuote,
} from '../lib/supabase';
import type { ProjectItem, ProjectQuote, ProjectQuoteLine } from '../types';

interface Props {
  visible: boolean;
  item: ProjectItem | null;
  room: string | null;
  quotes: ProjectQuote[];
  /** Set-aside amounts on signed quotes — what this thing may be chosen against. */
  setAsides: ProjectQuoteLine[];
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onAddOption: (item: ProjectItem) => void;
  onOpenBill: (quote: ProjectQuote) => void;
  onRecordInHouse: (item: ProjectItem) => void;
}

/**
 * One thing being bought — a toilet, a kitchen — and the options for it.
 *
 * **Comparing is the point, so there are several options, not one price.** An
 * item used to carry one active price with the rest filed under *Also on
 * record*, which was right for recording a bill and wrong for the evening spent
 * comparing three toilets. Each option is a quote on this item, nothing is
 * agreed until *Choose*, and the ones not chosen stay on the record, faded.
 *
 * **Choosing is the moment the set-aside is settled.** When the thing belongs to
 * a set-aside amount in a builder's quote, choosing asks one question — *who
 * will bill you for it?* — and writes both links the allowance rules need:
 * `supersedes_line_id` (which set-aside this answers) and `billed_through_id`
 * (whether the builder passes it on). No screen could set either before V2, so
 * an allowance and the thing that replaced it both counted.
 */
export default function ThingSheet({
  visible, item, room, quotes, setAsides, onClose, onChanged, onAddOption, onOpenBill, onRecordInHouse,
}: Props) {
  const [choosing, setChoosing] = useState<ProjectQuote | null>(null);
  const [through, setThrough] = useState<'direct' | 'builder'>('direct');
  const [notes, setNotes] = useState('');
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setChoosing(null);
    setThrough('direct');
    setNotes(item?.notes ?? '');
    setLinking(false);
  }, [visible, item?.id]);

  if (!item) return null;

  const options = quotes
    .filter((q) => q.itemId === item.id && q.kind === 'quote')
    .sort((a, b) => (a.amountIncl ?? 0) - (b.amountIncl ?? 0));
  const bills = quotes.filter((q) => q.itemId === item.id && q.kind === 'invoice');
  const chosen = options.find((q) => q.status === 'accepted') ?? null;
  const setAside = setAsides.find((l) => l.id === item.setAsideLineId) ?? null;
  const builderQuote = setAside ? quotes.find((q) => q.id === setAside.quoteId) ?? null : null;
  const soFar = setAside ? chosenAgainst({ quotes }, setAside.id) : 0;

  async function run(work: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await onChanged(message);
    } catch (err: unknown) {
      await onChanged(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(false);
    }
  }

  function choose(option: ProjectQuote) {
    if (setAside) {
      setThrough(option.billedThroughId ? 'builder' : 'direct');
      setChoosing(option);
      return;
    }
    run(() => chooseOption(option.id, { setAsideLineId: null, billedThroughId: null }), 'Chosen');
  }

  async function confirmChoice() {
    if (!choosing || !setAside) return;
    await run(
      () => chooseOption(choosing.id, {
        setAsideLineId: setAside.id,
        billedThroughId: through === 'builder' ? setAside.quoteId : null,
      }),
      'Chosen',
    );
    setChoosing(null);
  }

  function undo(option: ProjectQuote) {
    run(async () => {
      await setQuoteStatus(option.id, 'tbc');
      await updateQuote(option.id, { supersedesLineId: null, billedThroughId: null });
    }, 'Back to undecided');
  }

  // ------------------------------------------------------------- choosing
  if (choosing && setAside) {
    const setAsideAmount = setAside.amountInclGst ? setAside.amount ?? 0 : (setAside.amount ?? 0) * 1.15;
    return (
      <Sheet
        visible={visible}
        title={choosing.detail ?? item.name}
        subtitle={`${formatMoney(choosing.amountIncl) ?? '—'} · ${choosing.supplier ?? 'No supplier named'}`}
        onClose={() => setChoosing(null)}
        footer={<PrimaryButton label={`Choose ${choosing.detail ?? 'this one'}`} onPress={confirmChoice} busy={busy} />}
      >
        <View style={groupedStyles.block}>
          <Text style={groupedStyles.question}>Who will bill you for it?</Text>
          <Group>
            <RadioRow
              title={choosing.supplier ?? 'The supplier'}
              subtitle="You pay them directly"
              selected={through === 'direct'}
              onPress={() => setThrough('direct')}
            />
            <RadioRow
              title={builderQuote?.supplier ?? 'The builder'}
              subtitle="On their bills"
              selected={through === 'builder'}
              onPress={() => setThrough('builder')}
            />
          </Group>
        </View>
        <Group>
          <Row title={`${setAside.name} set aside`} value={formatMoney(setAsideAmount)} />
          <Row
            title="Chosen so far"
            value={formatMoney(soFar - (choosing.status === 'accepted' ? choosing.amountIncl ?? 0 : 0) + (choosing.amountIncl ?? 0))}
          />
        </Group>
      </Sheet>
    );
  }

  // ---------------------------------------------------------------- thing
  return (
    <>
      <Sheet
        visible={visible && !confirmRemove}
        title={item.name}
        subtitle={[room, setAside ? `${setAside.name} · ${formatMoney(setAside.amountInclGst ? setAside.amount : (setAside.amount ?? 0) * 1.15)} set aside` : null]
          .filter(Boolean).join(' · ') || null}
        onClose={onClose}
        closeLabel="Done"
      >
        <View style={groupedStyles.block}>
          <View style={styles.headingRow}>
            <Text style={styles.heading}>Options</Text>
            <Text style={styles.count}>{options.filter((o) => o.status !== 'declined').length}</Text>
          </View>
          {options.length > 0 ? (
            <Group>
              {options.map((option) => {
                const isChosen = option.status === 'accepted';
                const faded = option.status === 'declined' || (chosen !== null && !isChosen);
                return (
                  <Row
                    key={option.id}
                    title={option.detail ?? option.supplier ?? 'A price'}
                    subtitle={[
                      option.detail ? option.supplier : null,
                      isChosen ? (option.billedThroughId ? 'Chosen · on the builder’s bills' : 'Chosen') : null,
                      option.status === 'declined' ? 'Turned down' : null,
                    ].filter(Boolean).join(' · ') || null}
                    value={formatMoney(option.amountIncl)}
                    dim={faded}
                    bold={isChosen}
                    leading={(
                      <View style={[styles.thumb, isChosen && styles.thumbOn]}>
                        <Icon
                          name={isChosen ? 'checkmark' : 'pricetag-outline'}
                          size={18}
                          color={isChosen ? Colors.white : Colors.textMuted}
                        />
                      </View>
                    )}
                    accessory={
                      isChosen
                        ? <Pill label="Undo" onPress={() => undo(option)} accessibilityLabel={`Undo choosing ${option.detail ?? option.supplier ?? 'this'}`} disabled={busy} />
                        : option.status === 'declined'
                          ? null
                          : <Pill label="Choose" onPress={() => choose(option)} accessibilityLabel={`Choose ${option.detail ?? option.supplier ?? 'this'}`} disabled={busy} />
                    }
                  />
                );
              })}
            </Group>
          ) : null}
          <AddRow label="Add an option" onPress={() => onAddOption(item)} />
        </View>

        {bills.length > 0 ? (
          <View style={groupedStyles.block}>
            <Text style={styles.heading}>Bills</Text>
            <Group>
              {bills.map((bill) => (
                <Row
                  key={bill.id}
                  title={bill.supplier ?? 'A bill'}
                  subtitle={(bill.unpaid ?? 0) > 0 ? 'To pay' : 'Paid'}
                  value={formatMoney(bill.amountIncl)}
                  onPress={() => onOpenBill(bill)}
                />
              ))}
            </Group>
          </View>
        ) : null}

        {setAsides.length > 0 ? (
          <View style={groupedStyles.block}>
            <Group>
              <Row
                title="Set aside in"
                value={setAside?.name ?? 'Nothing'}
                tone="muted"
                onPress={() => setLinking((open) => !open)}
                accessibilityLabel="Which set-aside amount this comes out of"
              />
              {linking ? (
                <View>
                  {[null, ...setAsides].map((line) => (
                    <RadioRow
                      key={line?.id ?? 'none'}
                      title={line ? line.name : 'Nothing'}
                      subtitle={line ? formatMoney(line.amountInclGst ? line.amount : (line.amount ?? 0) * 1.15) : null}
                      selected={(item.setAsideLineId ?? null) === (line?.id ?? null)}
                      onPress={() => {
                        setLinking(false);
                        run(() => setItemSetAside(item.id, line?.id ?? null), 'Saved');
                      }}
                    />
                  ))}
                </View>
              ) : null}
            </Group>
          </View>
        ) : null}

        <View style={groupedStyles.block}>
          <Text style={styles.heading}>Is it in?</Text>
          <Segmented
            accessibilityLabel="Is it in?"
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Not yet' }]}
            value={item.status === 'installed' ? 'yes' : 'no'}
            onChange={(next) => {
              const installed = next === 'yes';
              if (installed === (item.status === 'installed')) return;
              run(() => updateItem(item.id, { status: installed ? 'installed' : 'considering' }), installed ? 'Installed' : 'Saved');
            }}
          />
          {item.status === 'installed' ? (
            <TextButton label="Add it to the house record" onPress={() => onRecordInHouse(item)} />
          ) : null}
        </View>

        <View style={groupedStyles.block}>
          <Text style={styles.heading}>Notes</Text>
          <TextInput
            style={styles.notes}
            value={notes}
            onChangeText={setNotes}
            onBlur={() => {
              if ((item.notes ?? '') === notes) return;
              run(() => updateItem(item.id, { notes: notes.trim() ? notes : null }), 'Saved');
            }}
            placeholder="Add a note"
            placeholderTextColor={Colors.textMuted}
            multiline
            accessibilityLabel="Notes"
          />
        </View>

        <View style={styles.actions}>
          <TextButton
            label={item.excluded ? 'Put it back in the job' : 'Decide against it'}
            onPress={() => run(() => setItemExcluded(item.id, !item.excluded), item.excluded ? 'Back in' : 'Left out of the totals')}
          />
          <TextButton label="Remove" tone="danger" onPress={() => setConfirmRemove(true)} />
        </View>
      </Sheet>

      <ConfirmDialog
        visible={confirmRemove}
        title={`Remove ${item.name}?`}
        message={
          options.length + bills.length > 0
            ? `${options.length + bills.length === 1 ? 'Its 1 price goes' : `Its ${options.length + bills.length} prices go`} with it.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          run(async () => {
            const paths = await deleteItem(item.id);
            await deleteStoredFiles(paths);
          }, 'Removed').then(onClose);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  heading: {
    fontSize: Typography.title3, fontWeight: Typography.semibold, color: Colors.textPrimary,
    letterSpacing: -0.3, paddingHorizontal: 4,
  },
  count: { fontSize: Typography.body, color: Colors.textMuted },
  thumb: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: Colors.sunken,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbOn: { backgroundColor: Colors.primary },
  notes: {
    minHeight: 96, textAlignVertical: 'top', backgroundColor: Colors.surface, borderRadius: Radius.card,
    padding: Spacing.lg, fontSize: Typography.body, color: Colors.textPrimary,
  },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
});
