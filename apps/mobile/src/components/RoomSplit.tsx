import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import Icon from './Icon';
import { Group, Pill, Segmented, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { evenSplit, formatMoney, matchRooms, splitKind, splitLeft, type SplitKind } from '@snag/supabase-queries';
import type { Location, ProjectElement } from '../types';

/** What the picker holds: which rooms, how it splits, and what was typed for each. */
export interface RoomSplitValue {
  ids: string[];
  kind: SplitKind;
  /** The typed share per element id — only read when `kind` is `amounts`. */
  typed: Record<string, string>;
}

/**
 * The picker opened on what a card or a price already says. Nothing split yet
 * opens on *Evenly*, so ticking a second room offers the common answer; a set
 * already saved as "don't split" opens on that.
 */
export function splitValueFrom(
  ids: string[],
  amounts: (number | null)[] | null,
  total: number | null,
  splitFrom: number,
): RoomSplitValue {
  const kind = ids.length < splitFrom ? 'even' : splitKind(amounts, total);
  const typed: Record<string, string> = {};
  if (kind !== 'none' && amounts) ids.forEach((id, i) => { typed[id] = String(amounts[i] ?? ''); });
  return { ids, kind, typed };
}

/**
 * Where a shared bill sits, in words: *Whole job*, or the rooms it is shared
 * between and how. (A bill *on* one room is just that room's name.) What the card says before it is allocated and what a price
 * says after, so the two cannot describe one answer two ways.
 */
export function describeRooms(
  ids: string[],
  amounts: (number | null)[] | null,
  total: number | null,
  elements: ProjectElement[],
): string {
  const names = ids
    .map((id) => elements.find((e) => e.id === id)?.name)
    .filter((n): n is string => !!n);
  if (names.length === 0) return 'Whole job';
  const kind = splitKind(amounts, total);
  const how = kind === 'even' ? (names.length === 1 ? 'all of it' : 'split evenly')
    : kind === 'amounts' ? 'split by amount' : 'not split';
  return `${names.join(', ')} · ${how}`;
}

const parseShare = (text: string): number | null => {
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return text.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * What to write, or the sentence saying why not.
 *
 * `splitFrom` is how many rooms it takes before there is a split to ask about:
 * two on a waiting bill, where one room means the bill lands *on* that room,
 * and one on a price already on the whole job, which can only ever be shared.
 * Evenly is worked out here, to the cent, against the figure as it stands.
 */
export function resolveSplit(
  value: RoomSplitValue,
  total: number | null,
  splitFrom: number,
): { ids: string[]; amounts: number[] | null } | { error: string } {
  const { ids, kind, typed } = value;
  if (ids.length < splitFrom || kind === 'none') return { ids, amounts: null };
  if (total === null) return { error: 'Put a figure on it before splitting it.' };
  if (kind === 'even') return { ids, amounts: evenSplit(total, ids.length) };

  const amounts = ids.map((id) => parseShare(typed[id] ?? ''));
  if (amounts.some((a) => a === null)) return { error: 'Give every room a share, or choose Don’t split.' };
  if (splitLeft(total, amounts as number[]) < 0) return { error: 'The rooms add up to more than the bill.' };
  return { ids, amounts: amounts as number[] };
}

interface Props {
  /** The parts of the job. An implicit one is never offered — it is the job. */
  elements: ProjectElement[];
  /** The house's rooms, offered when adding one to the job. */
  locations: Location[];
  value: RoomSplitValue;
  /** A state setter: every change is applied to the latest value, never a stale one. */
  onChange: React.Dispatch<React.SetStateAction<RoomSplitValue>>;
  /** The bill's figure as typed, and whether it includes GST. */
  total: number | null;
  inclusive: boolean;
  splitFrom: number;
  /** Adds a room to the job and answers with its element id, or null if it didn't. */
  onAddRoom?: (name: string) => Promise<string | null>;
  question?: string;
}

/**
 * Which rooms a bill is for, and how it splits between them.
 *
 * **The rooms are the parts of this job, and a new one can be made here.** A
 * tile order that turns out to be for the laundry too is noticed at the moment
 * somebody is checking the bill, and sending them to the rooms sheet and back
 * would lose the card they were answering. A room made here is a part of the
 * job and a room of the house, through the same writers the rooms sheet uses,
 * and it is ticked the moment it exists.
 *
 * **Three answers to how it splits, and "don't" is one of them.** Somebody
 * often knows the contract covers the bathroom and the laundry without anybody
 * having said how much each: the rooms go on record and the money stays on the
 * whole job, rather than a split the app invented. Evenly is the default
 * because it is the most common true answer for materials bought for two rooms;
 * by amount says what is left on the whole job as it is typed.
 */
export default function RoomSplit({
  elements, locations, value, onChange, total, inclusive, splitFrom, onAddRoom,
  question = 'Which rooms is it for?',
}: Props) {
  const parts = elements.filter((e) => !e.implicit);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const taken = useMemo(
    () => new Set(parts.map((p) => (p.room ?? p.name).trim().toLowerCase())),
    [parts],
  );
  const offered = useMemo(
    () => matchRooms(locations, name).filter((l) => !taken.has(l.name.trim().toLowerCase())).slice(0, 5),
    [locations, name, taken],
  );
  const typedName = name.trim();
  const exact = typedName !== ''
    && (taken.has(typedName.toLowerCase()) || offered.some((l) => l.name.toLowerCase() === typedName.toLowerCase()));

  const toggle = (id: string) => onChange((v) => ({
    ...v, ids: v.ids.includes(id) ? v.ids.filter((x) => x !== id) : [...v.ids, id],
  }));

  async function add(room: string) {
    if (!onAddRoom || busy) return;
    setBusy(true);
    try {
      const id = await onAddRoom(room);
      if (id) {
        onChange((v) => ({ ...v, ids: v.ids.includes(id) ? v.ids : [...v.ids, id] }));
        setName('');
        setAdding(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const splitting = value.ids.length >= splitFrom;
  const inRooms = value.ids
    .map((id) => parts.find((p) => p.id === id))
    .filter((p): p is ProjectElement => !!p);
  const even = total !== null ? evenSplit(total, inRooms.length) : [];
  const typedAmounts = inRooms.map((p) => parseShare(value.typed[p.id] ?? '') ?? 0);
  const left = total !== null ? splitLeft(total, typedAmounts) : null;
  const basis = inclusive ? '' : ' ex GST';

  return (
    <View style={groupedStyles.block}>
      <Text style={groupedStyles.question}>{question}</Text>
      <Group>
        {parts.map((part) => {
          const on = value.ids.includes(part.id);
          return (
            <Pressable
              key={part.id}
              onPress={() => toggle(part.id)}
              style={styles.check}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={part.name}
            >
              <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? Colors.primary : Colors.chevron} />
              <Text style={styles.checkLabel}>{part.name}</Text>
            </Pressable>
          );
        })}
        {onAddRoom ? (
          adding ? (
            <View style={styles.adding}>
              <View style={styles.addField}>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Room name"
                  placeholderTextColor={Colors.textMuted}
                  autoFocus
                  accessibilityLabel="New room"
                  onSubmitEditing={() => typedName && !exact && add(typedName)}
                />
                <Pill label="Cancel" onPress={() => { setAdding(false); setName(''); }} />
              </View>
              {offered.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => add(l.name)}
                  style={styles.offer}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${l.name}`}
                >
                  <Icon name="add" size={18} color={Colors.primary} />
                  <Text style={styles.offerLabel}>{l.name}</Text>
                </Pressable>
              ))}
              {typedName && !exact ? (
                <Pressable
                  onPress={() => add(typedName)}
                  style={styles.offer}
                  accessibilityRole="button"
                  accessibilityLabel={`Add “${typedName}”`}
                >
                  <Icon name="add" size={18} color={Colors.primary} />
                  <Text style={styles.offerLabel}>Add “{typedName}”</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Pressable
              onPress={() => setAdding(true)}
              style={styles.check}
              accessibilityRole="button"
              accessibilityLabel="Add a room…"
            >
              <Icon name="add" size={22} color={Colors.primary} />
              <Text style={[styles.checkLabel, styles.addLabel]}>Add a room…</Text>
            </Pressable>
          )
        ) : null}
      </Group>

      {value.ids.length === 0 ? (
        <Text style={groupedStyles.hint}>None ticked — it goes on the whole job.</Text>
      ) : null}
      {splitFrom > 1 && value.ids.length === 1 ? (
        <Text style={groupedStyles.hint}>All of it goes on {inRooms[0]?.name ?? 'that room'}.</Text>
      ) : null}

      {splitting ? (
        <>
          <Segmented<SplitKind>
            accessibilityLabel="How it splits"
            options={[
              { value: 'even', label: inRooms.length === 1 ? 'All of it' : 'Evenly' },
              { value: 'amounts', label: 'By amount' },
              { value: 'none', label: 'Don’t split' },
            ]}
            value={value.kind}
            onChange={(kind) => onChange((v) => ({ ...v, kind }))}
          />
          {value.kind === 'none' ? (
            <Text style={groupedStyles.hint}>The rooms are on record; the money stays on the whole job.</Text>
          ) : total === null ? (
            <Text style={groupedStyles.hint}>Put a figure on it first to split it.</Text>
          ) : (
            <Group>
              {inRooms.map((part, i) => (
                <View key={part.id} style={styles.share}>
                  <Text style={styles.checkLabel} numberOfLines={1}>{part.name}</Text>
                  {value.kind === 'even' ? (
                    <Text style={styles.figure}>{formatMoney(even[i])}{basis}</Text>
                  ) : (
                    <TextInput
                      style={[styles.input, styles.amount]}
                      value={value.typed[part.id] ?? ''}
                      onChangeText={(text) => onChange((v) => ({ ...v, typed: { ...v.typed, [part.id]: text } }))}
                      placeholder="$0"
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`${part.name} share`}
                    />
                  )}
                </View>
              ))}
            </Group>
          )}
          {value.kind === 'amounts' && left !== null ? (
            <Text style={[groupedStyles.hint, left < 0 && styles.over]} accessibilityLiveRegion="polite">
              {left > 0 ? `${formatMoney(left)}${basis} stays on the whole job`
                : left < 0 ? `${formatMoney(-left)}${basis} more than the bill`
                  : 'Adds up to the bill'}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  check: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    minHeight: MIN_TOUCH_TARGET + 4, paddingHorizontal: Spacing.lg,
  },
  checkLabel: { flex: 1, minWidth: 0, fontSize: Typography.body, color: Colors.textPrimary },
  addLabel: { color: Colors.primary },
  adding: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, gap: Spacing.xs },
  addField: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: { flex: 1, minWidth: 0, fontSize: Typography.body, color: Colors.textPrimary, minHeight: 36 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: MIN_TOUCH_TARGET },
  offerLabel: { fontSize: Typography.body, color: Colors.primary },
  share: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    minHeight: MIN_TOUCH_TARGET + 4, paddingHorizontal: Spacing.lg,
  },
  figure: { fontSize: Typography.body, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  amount: { flex: 0, width: 120, textAlign: 'right', fontVariant: ['tabular-nums'] },
  over: { color: Colors.danger },
});
