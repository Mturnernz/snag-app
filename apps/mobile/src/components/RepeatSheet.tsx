import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import { CycleUnit, MAX_CYCLE_DAYS, cycleDays, cycleParts } from '@snag/supabase-queries';
import Icon from './Icon';
import Sheet from './Sheet';
import { Group, RadioRow, Segmented } from './Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  visible: boolean;
  /** The job's repeat now, in days; null for none. */
  current: number | null;
  /**
   * Writes a repeat, in days, or null for *Never*. The caller decides what a
   * press of the one already set does — an undated repeat is dated by it — and
   * a throw keeps the sheet open with the reason under the choices.
   */
  onPick: (days: number | null) => Promise<void>;
  onClose: () => void;
}

/** What the *Every* row shows on a job that does not repeat yet. */
const FIRST = { n: 1, unit: 'month' as CycleUnit };

function unitLabel(unit: CycleUnit, count: string): string {
  return count === '1' ? unit : `${unit}s`;
}

/**
 * How often a job comes round — the sheet the *Repeats* row opens.
 *
 * **Never, or every *n* days, weeks, months or years**, by the owner's
 * decision: it was a list of five presets, and a filter that wants changing
 * every eight weeks had no answer in it. The number and the unit are the ones
 * `describeCycle` says a cycle back in (`cycleParts`), so the sheet and the row
 * under it cannot say one repeat two ways, and it is stored as days, as ever.
 *
 * It follows the saving rule. *Never* writes and closes. The unit and the
 * *Every* mark are taps and write when pressed. The number is a box, so it
 * writes when it is left — on Return, on blur, and on any way out of the
 * sheet — and only when it says something new: tabbing through it must not
 * start a repeat. A number that cannot be a repeat holds the sheet open and
 * says why, rather than closing over what somebody typed. There is no line of
 * prose under it, also by the owner's decision.
 */
export default function RepeatSheet({ visible, current, onPick, onClose }: Props) {
  const [draft, setDraft] = useState('');
  const [unit, setUnit] = useState<CycleUnit>(FIRST.unit);
  // Typed into since the sheet opened or last wrote — which lights *Every*
  // before the write has landed.
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs beside the state, for the reason `partRef` exists on the job page:
  // Return and the blur after it land in one gesture, before a re-render, and
  // reading state would send the same repeat twice.
  const draftRef = useRef('');
  const dirtyRef = useRef(false);
  /** The repeat the sheet last knew to be on the job — what the box is compared with. */
  const sentRef = useRef<number | null>(null);
  /** A write still in flight, so leaving the sheet waits for it rather than hiding its failure. */
  const pendingRef = useRef<Promise<boolean> | null>(null);

  // Seeded each time it opens and never while open: a write that lands while
  // somebody is still in the box must not rewrite what they are typing.
  useEffect(() => {
    if (!visible) return;
    const parts = current ? cycleParts(current) : FIRST;
    draftRef.current = String(parts.n);
    dirtyRef.current = false;
    sentRef.current = current;
    pendingRef.current = null;
    setDraft(String(parts.n));
    setUnit(parts.unit);
    setTouched(false);
    setBusy(false);
    setError(null);
  }, [visible]);

  function send(days: number | null): Promise<boolean> {
    const before = sentRef.current;
    sentRef.current = days;
    setBusy(true);
    setError(null);
    const write = onPick(days)
      .then(() => {
        dirtyRef.current = false;
        return true;
      })
      .catch((err: unknown) => {
        sentRef.current = before;
        setError(err instanceof Error ? err.message : 'That didn’t change');
        return false;
      })
      .finally(() => {
        setBusy(false);
        if (pendingRef.current === write) pendingRef.current = null;
      });
    pendingRef.current = write;
    return write;
  }

  /**
   * The *Every* row's answer, written when it says something new. `always` is
   * the mark's own press, which the caller may still turn into a date for an
   * undated repeat.
   */
  function sendEvery(text: string, every: CycleUnit, always = false): Promise<boolean> {
    const n = Number(text);
    if (!/^\d+$/.test(text) || n < 1) {
      setError('Type how many');
      return Promise.resolve(false);
    }
    const days = cycleDays(n, every);
    if (days > MAX_CYCLE_DAYS) {
      setError('Ten years is the longest');
      return Promise.resolve(false);
    }
    if (!always && days === sentRef.current) {
      dirtyRef.current = false;
      setError(null);
      return Promise.resolve(true);
    }
    return send(days);
  }

  function type(text: string) {
    const digits = text.replace(/[^0-9]/g, '');
    draftRef.current = digits;
    dirtyRef.current = true;
    setDraft(digits);
    setTouched(true);
  }

  function leaveBox() {
    if (dirtyRef.current) void sendEvery(draftRef.current, unit);
  }

  function pickUnit(next: CycleUnit) {
    setUnit(next);
    void sendEvery(draftRef.current, next);
  }

  async function never() {
    if (await send(null)) onClose();
  }

  async function close() {
    if (pendingRef.current && !(await pendingRef.current)) return;
    if (dirtyRef.current && !(await sendEvery(draftRef.current, unit))) return;
    onClose();
  }

  const everyOn = current !== null || touched;

  return (
    <Sheet visible={visible} title="Repeats" onClose={close} closeLabel="Done">
      <Group>
        <RadioRow title="Never" selected={!everyOn} onPress={never} />
        <View style={styles.every}>
          <View style={styles.everyLine}>
            <Pressable
              onPress={() => sendEvery(draftRef.current, unit, true)}
              disabled={busy}
              style={styles.everyMark}
              accessibilityRole="radio"
              accessibilityState={{ selected: everyOn, checked: everyOn }}
              accessibilityLabel="Every"
            >
              <Icon
                name={everyOn ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={everyOn ? Colors.primary : Colors.chevron}
              />
              <Text style={styles.everyWord}>Every</Text>
            </Pressable>
            <TextInput
              style={styles.count}
              value={draft}
              onChangeText={type}
              onBlur={leaveBox}
              onSubmitEditing={leaveBox}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={4}
              selectTextOnFocus
              accessibilityLabel="How many"
            />
          </View>
          <View style={styles.units}>
            <Segmented
              options={(['day', 'week', 'month', 'year'] as CycleUnit[]).map((value) => ({
                value, label: unitLabel(value, draft),
              }))}
              value={unit}
              onChange={pickUnit}
              accessibilityLabel="Unit"
            />
          </View>
        </View>
      </Group>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  every: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  everyLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  everyMark: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: MIN_TOUCH_TARGET,
  },
  everyWord: { fontSize: Typography.body, lineHeight: 22, color: Colors.textPrimary },
  // A sunken well like every other box on the job page, wide enough for the
  // four digits ten years of days would take.
  count: {
    width: 72,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  // Under the number, lined up with the word *Every* rather than the mark.
  units: { paddingLeft: 22 + Spacing.md, paddingBottom: Spacing.xs },
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
});
