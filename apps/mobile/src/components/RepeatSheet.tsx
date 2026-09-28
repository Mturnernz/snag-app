import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import { Group, RadioRow, groupedStyles } from './Grouped';
import { Colors, Typography } from '../constants/theme';

export interface RepeatChoice {
  /** Null is *Never*. */
  days: number | null;
  label: string;
}

interface Props {
  visible: boolean;
  choices: RepeatChoice[];
  /** The job's repeat now, null for none. */
  current: number | null;
  /** One line under the choices: what marking it done does, and that nothing reminds anybody. */
  hint: string;
  /**
   * Writes the choice. The caller decides what a press of the lit one does —
   * an undated repeat is dated by it — and a throw keeps the sheet open with
   * the reason under the choices.
   */
  onPick: (days: number | null) => Promise<void>;
  onClose: () => void;
}

/**
 * How often a job comes round — the sheet the *Repeats* row opens.
 *
 * It replaced a rail of five chips on the page, by the owner's decision: one
 * row saying the answer takes a line where the rail took three. What made the
 * old modal behind a *Yes* a trap does not come back with it. **A press
 * writes** and the sheet closes behind it, the app's rule for a tap, so there
 * is no *Done* to forget; closing without a press writes nothing, and the row
 * underneath still says what is true; and there is no date in here, because a
 * job's only date is the one its repeat sets.
 */
export default function RepeatSheet({
  visible, choices, current, hint, onPick, onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setBusy(false);
    setError(null);
  }, [visible]);

  async function pick(days: number | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(days);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t change');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="Repeats" onClose={onClose} closeLabel="Done">
      <Group>
        {choices.map((choice) => (
          <RadioRow
            key={choice.days ?? 'never'}
            title={choice.label}
            selected={choice.days === current}
            onPress={() => pick(choice.days)}
          />
        ))}
      </Group>
      {hint ? <Text style={groupedStyles.hint}>{hint}</Text> : null}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
});
