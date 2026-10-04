import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import SetupShell, { setupStyles } from '../SetupShell';
import Icon from '../../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../../constants/theme';
import { createLocation, deleteLocation, getLocations, getMyProperties } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import { roomIcon } from '../../lib/roomIcon';
import { SETUP_STEPS } from '../steps';
import type { StepProps } from '../types';
import type { Location } from '../../types';

const CHANGE_LATER = SETUP_STEPS.find((step) => step.id === 'rooms')?.changeLater;

/**
 * *Here are your rooms* — a grid of cards, shown once so the house can be made
 * to match.
 *
 * **A new place is seeded with three rooms** (Kitchen, Laundry, Master
 * bedroom) since October 2026, where it had twelve. Twelve was a list to read
 * and prune before anything else could happen; three is a start somebody adds
 * to. So the step is the rooms as cards, two to a row, and a dashed card with
 * a fern + — *Add another room* — that opens a name box in place. A card's ×
 * takes a room away, written on the press like everything else here.
 *
 * It writes through `create_location` / `delete_location`, the functions
 * Location tags' `RoomsEditor` uses, so the two cannot disagree about what
 * adding or removing a room does.
 *
 * The second person in a house sees it too: they may know about the
 * conservatory the first one forgot. For them a removal still asks, because
 * the rooms are the other person's too.
 */
export default function RoomsStep({ ctx, progress, onBack, onNext }: StepProps) {
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Location[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getMyProperties()
      .then((places) => {
        const mine = places.filter((p) => p.householdId === ctx.household?.id);
        if (live) setPropertyId((mine[0] ?? places[0])?.id ?? null);
      })
      .catch((err) => console.error('Failed to load the place:', err));
    return () => { live = false; };
  }, [ctx.household?.id]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      setRooms(await getLocations(propertyId));
    } catch (err: any) {
      showAlert("Couldn't load the rooms", err?.message ?? 'Please try again.');
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    const next = name.trim();
    if (!next || !propertyId || busy) return;
    setBusy(true);
    try {
      await createLocation(propertyId, next);
      setName('');
      setAdding(false);
      await load();
    } catch (err: any) {
      // The box stays open with the words in it: a refused name is still the
      // answer somebody gave, and a duplicate is said in words by the server.
      showAlert("Couldn't add that room", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(room: Location) {
    setBusy(true);
    try {
      await deleteLocation(room.id);
      await load();
    } catch (err: any) {
      showAlert("Couldn't remove that room", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function askRemove(room: Location) {
    if (ctx.memberCount <= 1) {
      remove(room);
      return;
    }
    showAlert(
      `Remove ${room.name}?`,
      'Jobs already filed there keep the room — it just stops being offered when you add something new.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove(room) },
      ],
    );
  }

  // The rooms and the dashed card, two to a row. Pairs rather than a wrapped
  // flex line, for the House tab's reason: a lone last card stays half width.
  const cells: (Location | 'add')[] = [...rooms, 'add'];
  const pairs: (Location | 'add')[][] = [];
  for (let i = 0; i < cells.length; i += 2) pairs.push(cells.slice(i, i + 2));

  return (
    <SetupShell
      progress={progress}
      onBack={onBack}
      icon="grid-outline"
      title="Here are your rooms"
      body="Here are your first rooms — you can add more when you're ready."
      primary={{ label: 'Continue', onPress: onNext }}
    >
      <View style={styles.grid}>
        {pairs.map((pair) => (
          <View key={pair.map((c) => (c === 'add' ? '+' : c.id)).join('|')} style={styles.row}>
            {pair.map((cell) => (cell === 'add' ? (
              <View key="add" style={[styles.card, styles.addCard]}>
                {adding ? (
                  <>
                    <TextInput
                      style={styles.input}
                      value={name}
                      onChangeText={setName}
                      autoFocus
                      maxLength={40}
                      autoCapitalize="sentences"
                      returnKeyType="done"
                      onSubmitEditing={add}
                      accessibilityLabel="Name the room"
                    />
                    <Pressable
                      onPress={add}
                      disabled={busy || !name.trim()}
                      style={styles.addConfirm}
                      accessibilityRole="button"
                      accessibilityLabel="Add the room"
                      accessibilityState={{ disabled: busy || !name.trim() }}
                    >
                      <Text style={[styles.addConfirmLabel, (busy || !name.trim()) && styles.off]}>
                        Add
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    onPress={() => setAdding(true)}
                    disabled={!propertyId}
                    style={styles.addOpen}
                    accessibilityRole="button"
                    accessibilityLabel="Add another room"
                  >
                    <View style={styles.plus}>
                      <Icon name="add" size="md" color={Colors.white} />
                    </View>
                    <Text style={styles.addLabel}>Add another room</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View key={cell.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Icon name={roomIcon(cell.name)} size="md" color={Colors.textSecondary} />
                  </View>
                  <Pressable
                    onPress={() => askRemove(cell)}
                    disabled={busy}
                    style={styles.remove}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${cell.name}`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                </View>
                <Text style={styles.name} numberOfLines={2}>{cell.name}</Text>
              </View>
            )))}
            {pair.length === 1 ? <View style={styles.spacer} /> : null}
          </View>
        ))}
      </View>
      {CHANGE_LATER ? (
        <Text style={setupStyles.hint}>You can change these any time from {CHANGE_LATER}.</Text>
      ) : null}
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  grid: { gap: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.md },
  spacer: { flex: 1 },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 104,
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  // The × is a full 48pt box pulled into the card's corner by a negative
  // margin, never hitSlop (which react-native-web ignores).
  remove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    margin: -Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: Typography.body, fontWeight: Typography.semibold, color: Colors.textPrimary,
  },
  addCard: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    justifyContent: 'center',
  },
  addOpen: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  plus: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.primary },
  input: {
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  addConfirm: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  addConfirmLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.primary },
  off: { color: Colors.textMuted },
});
