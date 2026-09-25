import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import { Group, RadioRow } from './Grouped';
import { Colors, Typography } from '../constants/theme';

export interface KindOption<T extends string> {
  value: T;
  label: string;
  /** What choosing it does to the money, in one line. */
  hint: string;
}

interface Props<T extends string> {
  visible: boolean;
  /** Who the paper is from, so the sheet says which one it is changing. */
  subtitle?: string | null;
  options: KindOption<T>[];
  value: T;
  /** Writes the new kind. A throw keeps the sheet open and says why. */
  onPick: (next: T) => Promise<void>;
  onClose: () => void;
}

/**
 * Saying what a piece of paper is — the sheet the kind pill opens.
 *
 * **A press writes**, the app's rule for a tap, and the sheet closes behind
 * it. Pressing the kind it already is writes nothing. Each answer says in one
 * line what it does to the money, because that is the whole reason the answer
 * matters: an invoice is something to pay, a quote is a price nobody may have
 * agreed to, and paperwork counts towards nothing.
 *
 * A refusal — a paid invoice cannot become a quote, a contract with progress
 * bills against it cannot become an invoice — is said here, in the server's
 * words, with the sheet still open, because it is a fact about this choice.
 */
export default function KindSheet<T extends string>({
  visible, subtitle, options, value, onPick, onClose,
}: Props<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setBusy(false);
    setError(null);
  }, [visible]);

  async function pick(next: T) {
    if (busy) return;
    if (next === value) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      await onPick(next);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t change');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="What is it?" subtitle={subtitle ?? null} onClose={onClose}>
      <Group>
        {options.map((option) => (
          <RadioRow
            key={option.value}
            title={option.label}
            subtitle={option.hint}
            selected={option.value === value}
            onPress={() => pick(option.value)}
          />
        ))}
      </Group>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
});
