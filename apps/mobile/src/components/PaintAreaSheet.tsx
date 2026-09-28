import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import { Group, TextButton, groupedStyles } from './Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { PAINT_AREA_SUGGESTIONS } from '../types';

interface Props {
  visible: boolean;
  /** The place being changed, or null when another is being added. */
  editing: string | null;
  /** Every place already on this paint, so none is offered twice. */
  areas: string[];
  /** A place chosen or typed: added, or put in place of the one being changed. */
  onChoose: (area: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Where a paint went: pick a place, or type one.
 *
 * **A tap writes when it is pressed**, as every chip in this app does, so
 * choosing *Architraves* is one tap and the sheet closes on it. The box for a
 * place the list does not have keeps a button beside it, because typing a new
 * one is creating something — the case the saving rule keeps buttons for — and
 * *Cancel* leaves without writing what was typed.
 *
 * A place already on this paint is lit and cannot be chosen again: two pills
 * saying *Ceiling* are one answer given twice. The one being changed stays
 * live, and pressing it again changes nothing.
 */
export default function PaintAreaSheet({ visible, editing, areas, onChoose, onRemove, onClose }: Props) {
  const [typed, setTyped] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  // A place somebody typed opens in the box, ready to correct; one of the
  // suggestions is already lit above it.
  useEffect(() => {
    if (!visible) return;
    setTyped(editing && !PAINT_AREA_SUGGESTIONS.some((s) => same(s, editing)) ? editing : '');
    setHint(null);
  }, [visible, editing]);

  const taken = (area: string) => areas.some((a) => same(a, area) && !(editing && same(a, editing)));

  function choose(area: string) {
    if (editing && same(area, editing)) {
      onClose();
      return;
    }
    if (taken(area)) return;
    onChoose(area);
  }

  function chooseTyped() {
    const value = typed.trim();
    if (!value) {
      setHint('Type where it went, or pick one above.');
      return;
    }
    if (taken(value)) {
      setHint(`${value} is already on this paint.`);
      return;
    }
    choose(value.charAt(0).toUpperCase() + value.slice(1));
  }

  const title = editing ? 'Where it went' : areas.length > 0 ? 'Where else did it go?' : 'Where did it go?';

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={styles.chips}>
        {PAINT_AREA_SUGGESTIONS.map((suggestion) => {
          const on = areas.some((a) => same(a, suggestion));
          const inert = taken(suggestion);
          return (
            <Pressable
              key={suggestion}
              onPress={() => choose(suggestion)}
              disabled={inert}
              style={styles.chipTap}
              accessibilityRole="button"
              accessibilityLabel={suggestion}
              accessibilityState={{ selected: on, disabled: inert }}
            >
              <View style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{suggestion}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={groupedStyles.block}>
        <Text style={groupedStyles.question}>Somewhere else</Text>
        <View style={styles.otherRow}>
          <Group style={styles.otherBox}>
            <TextInput
              style={styles.input}
              value={typed}
              onChangeText={(next) => { setTyped(next); setHint(null); }}
              onSubmitEditing={chooseTyped}
              returnKeyType="done"
              maxLength={60}
              accessibilityLabel="Somewhere else"
            />
          </Group>
          <Pressable
            onPress={chooseTyped}
            style={styles.add}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save' : 'Add'}
          >
            <Text style={styles.addLabel}>{editing ? 'Save' : 'Add'}</Text>
          </Pressable>
        </View>
        {hint ? <Text style={groupedStyles.hint} accessibilityLiveRegion="polite">{hint}</Text> : null}
      </View>

      {editing ? <TextButton label={`Remove ${editing}`} onPress={onRemove} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // The app's one chip: a sunken well when off, solid fern when on, no border,
  // the visible pill inside a 48px target.
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.sm },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  otherRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.sm },
  otherBox: { flex: 1, minWidth: 0, justifyContent: 'center' },
  input: {
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.lg,
    fontSize: Typography.body,
    color: Colors.textPrimary,
  },
  add: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: 72,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { fontSize: Typography.body, fontWeight: Typography.semibold, color: Colors.white },
});
