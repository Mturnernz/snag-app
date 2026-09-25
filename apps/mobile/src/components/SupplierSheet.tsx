import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import { Group, Pill, PrimaryButton, Row, SectionTitle, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';
import { businessKey, describeSupplier, type SupplierEntry } from '@snag/supabase-queries';

interface Props {
  /** The supplier being looked at; the sheet is shown while this is set. */
  supplier: SupplierEntry | null;
  /** Every supplier on the job, to merge into and to recognise a typed name. */
  all: SupplierEntry[];
  money: (n: number) => string;
  /** Renames them across the job. The caller owns the write and the toast. */
  onRename: (supplier: SupplierEntry, to: string) => Promise<void>;
  /** Asks to fold `from` into `to`. The caller confirms before anything is written. */
  onMerge: (from: SupplierEntry, to: SupplierEntry) => void;
  onClose: () => void;
}

/**
 * One supplier on a job: what they are called, and whether they are the same
 * business as another name on it.
 *
 * **Renaming is across the job**, through `home.rename_supplier`: every quote,
 * bill, expected cost and waiting bill that names them, in one write. Typing a
 * name another supplier on the job already has is a merge, not a rename, and
 * the button says so — the two then group as one supplier in every rollup.
 *
 * **Merging is also offered as a list**, every other supplier on the job with
 * the ones that look like the same business first. It is the way to merge for
 * somebody who cannot press and hold — a keyboard, a screen reader — and for a
 * target that is off screen, since the drag does not scroll. Either way a
 * merge is confirmed by the page before anything is written.
 *
 * **Save, not write-on-blur**, because a rename rewrites every row that names
 * the supplier, and a half-typed name must not do that on the way past. The
 * button is never dead: pressing it with the name unchanged just closes.
 */
export default function SupplierSheet({ supplier, all, money, onRename, onMerge, onClose }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supplier) return;
    setName(supplier.name);
    setError(null);
    setBusy(false);
  }, [supplier?.key]);

  if (!supplier) {
    return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;
  }

  const typed = name.trim();
  const others = all.filter((s) => s.key !== supplier.key);
  const match = others.find((s) => s.key === typed.toLowerCase()) ?? null;
  const mine = businessKey(supplier.name);
  const alike = (s: SupplierEntry) => mine !== null && businessKey(s.name) === mine;
  const ordered = [...others.filter(alike), ...others.filter((s) => !alike(s))];

  async function save() {
    if (!supplier || busy) return;
    if (!typed) {
      setError('What should they be called?');
      return;
    }
    if (match) {
      onMerge(supplier, match);
      return;
    }
    if (typed === supplier.name) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(supplier, typed);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible
      title={supplier.name}
      subtitle={describeSupplier(supplier, money) || null}
      onClose={onClose}
      footer={<PrimaryButton label={match ? 'Merge' : 'Save'} onPress={save} busy={busy} />}
    >
      <View style={groupedStyles.block}>
        <Text style={groupedStyles.question}>What they’re called</Text>
        <Group>
          <View style={styles.field}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(next) => { setName(next); setError(null); }}
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel="What they’re called"
            />
          </View>
        </Group>
        {match ? (
          <Text style={groupedStyles.hint}>{`${match.name} is already on this job. Saving combines the two.`}</Text>
        ) : null}
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </View>

      {ordered.length > 0 ? (
        <View style={groupedStyles.block}>
          <SectionTitle title="Same business as" />
          <Group>
            {ordered.map((other) => (
              <Row
                key={other.key}
                title={other.name}
                subtitle={alike(other) ? 'Looks like the same business' : describeSupplier(other, money) || null}
                accessory={(
                  <Pill
                    label="Merge"
                    onPress={() => onMerge(supplier, other)}
                    accessibilityLabel={`Merge ${supplier.name} into ${other.name}`}
                  />
                )}
              />
            ))}
          </Group>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2 },
  input: { fontSize: Typography.body, color: Colors.textPrimary, minHeight: 32 },
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
});
