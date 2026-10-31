import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from './Text';

import Sheet from './Sheet';
import { Group, RadioRow } from './Grouped';
import { Colors, Typography } from '../constants/theme';

export interface KindOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  visible: boolean;
  /** Who the paper is from, so the sheet says which one it is changing. */
  subtitle?: string | null;
  options: KindOption<T>[];
  value: T;
  /** The kind the paper's own words point to, marked *Suggested* when it is not already chosen. */
  suggested?: T | null;
  /** Writes the new kind. A throw keeps the sheet open and says why. */
  onPick: (next: T) => Promise<void>;
  onClose: () => void;
}

/**
 * Saying what a piece of paper is — the sheet the kind pill opens.
 *
 * **A press writes**, the app's rule for a tap, and the sheet closes behind
 * it. Pressing the kind it already is writes nothing. The options are the
 * words and nothing under them, by the owner's decision (October 2026): the
 * one line an option can carry is *Suggested*, on the kind the paper's own
 * words point to, so the likely answer is offered without a sentence
 * explaining the money.
 *
 * A refusal — a paid invoice cannot become a quote, a contract with progress
 * bills against it cannot become an invoice — is said here, in the server's
 * words, with the sheet still open, because it is a fact about this choice.
 */
export default function KindSheet<T extends string>({
  visible, subtitle, options, value, suggested = null, onPick, onClose,
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
            subtitle={option.value === suggested && option.value !== value ? 'Suggested' : undefined}
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
