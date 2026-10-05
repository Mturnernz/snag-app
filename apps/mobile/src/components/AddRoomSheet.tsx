import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import { roomAlreadyHere, roomsToOffer } from '@snag/supabase-queries';
import Sheet from './Sheet';
import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { roomIcon } from '../lib/roomIcon';

interface Props {
  visible: boolean;
  /** The place's rooms as they stand: what the cards leave out. */
  existing: string[];
  /** Writes the room. Resolves false when it was refused, having said why itself. */
  onAdd: (name: string) => Promise<boolean>;
  /**
   * Opens a room this place already has, when somebody types its name. The
   * House tab's door passes it; setup's has no room page to open, so it leaves
   * it out and the sheet only says the room is there.
   */
  onOpen?: (room: string) => void;
  onClose: () => void;
}

/**
 * *Add a room* — the rooms a house usually has and this one hasn't, as cards,
 * most common first, and a box for a room the list hasn't got.
 *
 * **One sheet, opened from the House tab and from setup's rooms step**, so the
 * two cannot come to offer different rooms or add them differently. Each caller
 * hands in its own write: the House tab's goes through `useAddThing.addRoom`,
 * setup's through the `create_location` its own grid reads back. Both are the
 * one function, so a room added from either is a room everywhere.
 *
 * **A card is drawn dashed, with a fern +**, the dashed *Add another room*
 * card's own language: it is a room this house does not have yet, and it must
 * not read as one it does. A tap writes it — the saving rule — and the card
 * leaves the sheet, which stays open, because the second bedroom is usually
 * followed by the third. *Done* closes it.
 *
 * **Leaving adds a name still in the box**, on *Done*, the backdrop or Android's
 * back, the same as every box in this app. A refused name holds the sheet open
 * with the words still there rather than closing over something it did not take.
 *
 * **A room this place already has is a way in, not a refusal.** Somebody typed
 * "Garage" into this box because they could not see the Garage: it was the
 * ninth tile of thirteen, below the fold, holding the weed killer they had just
 * recorded. The server refused the duplicate in a browser alert calling it a
 * tag. So the box is read against the rooms first (`roomAlreadyHere`), and a
 * match writes nothing: a line says the room is here, and on the House tab the
 * button becomes *Open*. Leaving with it in the box closes quietly, since there
 * is nothing left to add.
 */
export default function AddRoomSheet({ visible, existing, onAdd, onOpen, onClose }: Props) {
  const [draft, setDraft] = useState('');
  /** Rooms written from here, kept out of the cards before the caller's re-read lands. */
  const [added, setAdded] = useState<string[]>([]);
  /** The room being written, if any: one at a time, so two taps cannot race. */
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft('');
    setAdded([]);
  }, [visible]);

  const offered = useMemo(() => roomsToOffer([...existing, ...added]), [existing, added]);
  /** The room the box already names, if it names one this place has. */
  const already = useMemo(
    () => roomAlreadyHere([...existing, ...added], draft),
    [existing, added, draft],
  );

  const pairs = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < offered.length; i += 2) out.push(offered.slice(i, i + 2));
    return out;
  }, [offered]);

  async function add(name: string): Promise<boolean> {
    if (busy) return false;
    setBusy(name);
    try {
      const ok = await onAdd(name);
      if (ok) setAdded((prev) => [...prev, name]);
      return ok;
    } finally {
      setBusy(null);
    }
  }

  async function addTyped(): Promise<boolean> {
    const name = draft.trim();
    if (!name) return true;
    // Already here: nothing to add, and nothing to refuse.
    if (already) {
      setDraft('');
      return true;
    }
    const ok = await add(name);
    if (ok) setDraft('');
    return ok;
  }

  async function close() {
    if (busy) return;
    if (!(await addTyped())) return;
    onClose();
  }

  function submitTyped() {
    if (already) {
      if (onOpen) onOpen(already);
      return;
    }
    addTyped();
  }

  const typedOff = !!busy || !draft.trim();

  return (
    <Sheet
      visible={visible}
      title="Add a room"
      closeLabel="Done"
      onClose={close}
      footer={
        <View style={styles.footer}>
          {already ? (
            <Text style={styles.already} accessibilityLiveRegion="polite">
              {already} is already a room here
            </Text>
          ) : null}
          <View style={styles.other}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Name another room"
              placeholderTextColor={Colors.textMuted}
              maxLength={40}
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={submitTyped}
              accessibilityLabel="Name the room"
            />
            {already ? (
              // A dead button under the line would be a choice that isn't one,
              // so without a room page to open there is no button at all.
              onOpen ? (
                <Pressable
                  onPress={() => onOpen(already)}
                  style={styles.addButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${already}`}
                >
                  <Text style={styles.addButtonLabel}>Open</Text>
                </Pressable>
              ) : null
            ) : (
              <Pressable
                onPress={addTyped}
                disabled={typedOff}
                style={[styles.addButton, typedOff && styles.addButtonOff]}
                accessibilityRole="button"
                accessibilityLabel="Add the room"
                accessibilityState={{ disabled: typedOff, busy: !!busy && busy === draft.trim() }}
              >
                <Text style={[styles.addButtonLabel, typedOff && styles.addButtonLabelOff]}>Add</Text>
              </Pressable>
            )}
          </View>
        </View>
      }
    >
      {offered.length > 0 ? (
        <View style={styles.grid}>
          {pairs.map((pair) => (
            <View key={pair.join('|')} style={styles.row}>
              {pair.map((name) => (
                <Pressable
                  key={name}
                  onPress={() => add(name)}
                  disabled={!!busy}
                  style={[styles.card, busy === name && styles.cardBusy]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${name}`}
                  accessibilityState={{ disabled: !!busy, busy: busy === name }}
                >
                  <View style={styles.cardHead}>
                    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <Icon name={roomIcon(name)} size="md" color={Colors.textSecondary} />
                    </View>
                    <View style={styles.plus}>
                      <Icon name="add" size={16} color={Colors.white} />
                    </View>
                  </View>
                  <Text style={styles.name} numberOfLines={2}>{name}</Text>
                </Pressable>
              ))}
              {pair.length === 1 ? <View style={styles.spacer} /> : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.none}>Every room on the list is already here.</Text>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { gap: Spacing.md },
  // Pairs rather than a wrapped flex line, for the House tab's reason: a lone
  // last card stays half width rather than stretching into a banner.
  row: { flexDirection: 'row', gap: Spacing.md },
  spacer: { flex: 1 },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 88,
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    borderRadius: Radius.card,
  },
  cardBusy: { opacity: 0.5 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  plus: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: Typography.body, fontWeight: Typography.semibold, color: Colors.textPrimary },
  none: { fontSize: Typography.footnote, color: Colors.textMuted },
  footer: { gap: Spacing.sm },
  already: { fontSize: Typography.footnote, color: Colors.textSecondary },
  other: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  addButton: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET + Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Neutral when disabled, never faded: fern at half strength reads as broken
  // rather than as not-ready.
  addButtonOff: { backgroundColor: Colors.sunken },
  addButtonLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.white },
  addButtonLabelOff: { color: Colors.textMuted },
});
