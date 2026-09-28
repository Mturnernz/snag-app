import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import Card from './Card';
import Button from './Button';
import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import { createLocation, deleteLocation, getLocations } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { Location } from '../types';

interface Props {
  propertyId: string | null;
  /** After anything is added or removed — the list's chips read from the context. */
  onChanged?: () => Promise<void> | void;
  /**
   * Ask before removing. On by default: a tag stops being offered to everybody
   * in the house. First-run setup turns it off for a house that has only just
   * been made, where nothing has been filed and nobody else is offered anything.
   */
  confirmRemoval?: boolean;
  /**
   * The heading over the box. Location tags calls them tags; setup, which has
   * just said "Here are your rooms", calls them rooms. Only the words differ.
   */
  addLabel?: string;
}

/**
 * A place's rooms: add one, take one away.
 *
 * **One component, used by Location tags and by the rooms step of first-run
 * setup**, so the two cannot come to disagree about what adding or removing a
 * room does. Both write through `create_location` / `delete_location`, and
 * removing still leaves every snag filed under the name alone — `snags.room` is
 * TEXT for exactly that reason.
 *
 * It reads its own list rather than the household context, because setup runs
 * before there is a context to read from.
 */
export default function RoomsEditor({
  propertyId, onChanged, confirmRemoval = true, addLabel = 'Add a tag',
}: Props) {
  const { showToast } = useToast();
  const [tags, setTags] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      setTags(await getLocations(propertyId));
    } catch (err: any) {
      showAlert("Couldn't load the tags", err?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    const next = name.trim();
    if (!next || !propertyId) return;
    setBusy(true);
    try {
      await createLocation(propertyId, next);
      setName('');
      await load();
      await onChanged?.();
      showToast(`${next} added`);
    } catch (err: any) {
      showAlert("Couldn't add that tag", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleRemove(tag: Location) {
    if (!confirmRemoval) {
      remove(tag);
      return;
    }
    showAlert(
      `Remove ${tag.name}?`,
      'Jobs already filed there keep the tag — it just stops being offered when you add something new.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove(tag) },
      ]
    );
  }

  async function remove(tag: Location) {
    setBusy(true);
    try {
      await deleteLocation(tag.id);
      await load();
      await onChanged?.();
      showToast(`${tag.name} removed`);
    } catch (err: any) {
      showAlert("Couldn't remove that tag", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const canAdd = name.trim().length > 0 && !!propertyId && !busy;

  return (
    <View style={styles.wrap}>
      <Card elevation="md" style={styles.section}>
        <Text style={styles.sectionTitle}>{addLabel}</Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Boatshed"
            placeholderTextColor={Colors.textMuted}
            maxLength={40}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={() => canAdd && handleAdd()}
            accessibilityLabel="A room to add"
          />
          <Button label="Add" onPress={handleAdd} disabled={!canAdd} loading={busy} />
        </View>
      </Card>

      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : tags.length === 0 ? (
        <Text style={styles.empty}>
          No tags here yet. Add one above, or leave it — a snag doesn’t need one.
        </Text>
      ) : (
        <Card elevation="md" style={styles.list}>
          {tags.map((tag, index) => (
            <View key={tag.id} style={[styles.row, index > 0 && styles.rowDivided]}>
              <Icon name="pricetag-outline" size="md" color={Colors.textMuted} />
              <Text style={styles.rowLabel}>{tag.name}</Text>
              <Pressable
                onPress={() => handleRemove(tag)}
                disabled={busy}
                style={styles.remove}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${tag.name}`}
              >
                <Icon name="close" size="md" color={Colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  list: { paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: MIN_TOUCH_TARGET },
  rowDivided: { borderTopWidth: 1, borderTopColor: Colors.border },
  rowLabel: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  remove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { fontSize: Typography.sm, color: Colors.textMuted, textAlign: 'center' },
});
