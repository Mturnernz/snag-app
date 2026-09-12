import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { createLocation, deleteLocation, getLocations } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { Location } from '../types';

/**
 * The tags capture offers, per place.
 *
 * Twelve are seeded when a place is created so the chips are full on the day the
 * app is installed — a list derived from past use is empty exactly then. But
 * seeded was never meant to be closed: a bach needs a Boatshed, a villa needs a
 * Sleepout, and `Elsewhere` was standing in for this screen.
 *
 * Two things worth knowing before changing anything here:
 *
 * - **Tags belong to a property, not to the household.** So this screen has the
 *   same picker capture does, and for the same reason: it renders only when
 *   there is more than one place. Editing the house's tags must not quietly
 *   edit the bach's.
 * - **Removing a tag does not touch the snags filed under it.** `snags.room` is
 *   TEXT rather than a foreign key precisely so history survives: a snag logged
 *   in the Sleepout still reads Sleepout afterwards, and the list still filters
 *   on it. Removal only changes what capture offers next time, and the screen
 *   says so rather than leaving someone to guess whether they are about to
 *   rewrite a month of history.
 */
export default function LocationTagsScreen() {
  const navigation = useNavigation();
  const { properties, activeProperty, locations: activeLocations, reloadLocations } = useHousehold();
  const { showToast } = useToast();

  // Which place's tags are on screen. Starts on the one capture is pointed at,
  // which is the one someone just came from wanting a thirteenth tag.
  const [propertyId, setPropertyId] = useState<string | null>(activeProperty?.id ?? null);
  const [tags, setTags] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!propertyId && activeProperty) setPropertyId(activeProperty.id);
  }, [propertyId, activeProperty]);

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

  // The capture chips read from the context, so anything changed here has to be
  // pushed back into it — but only when it's the place capture is showing.
  async function syncCaptureChips() {
    if (propertyId === activeProperty?.id) await reloadLocations();
  }

  async function handleAdd() {
    const next = name.trim();
    if (!next || !propertyId) return;
    setBusy(true);
    try {
      await createLocation(propertyId, next);
      setName('');
      await load();
      await syncCaptureChips();
      showToast(`${next} added`);
    } catch (err: any) {
      showAlert("Couldn't add that tag", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(tag: Location) {
    showAlert(
      `Remove ${tag.name}?`,
      'Snags already filed there keep the tag — it just stops being offered when you add something new.',
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
      await syncCaptureChips();
      showToast(`${tag.name} removed`);
    } catch (err: any) {
      showAlert("Couldn't remove that tag", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const place = properties.find((p) => p.id === propertyId) ?? null;
  const canAdd = name.trim().length > 0 && !!propertyId && !busy;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Location tags" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Same rule as capture: a picker offering one option is a question
            with one answer. */}
        {properties.length > 1 ? (
          <View style={styles.places}>
            {properties.map((candidate) => {
              const active = candidate.id === propertyId;
              return (
                <Pressable
                  key={candidate.id}
                  onPress={() => setPropertyId(candidate.id)}
                  style={[styles.place, active && styles.placeActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Icon
                    name={active ? 'home' : 'home-outline'}
                    size="sm"
                    color={active ? Colors.white : Colors.textSecondary}
                  />
                  <Text style={[styles.placeLabel, active && styles.placeLabelActive]}>
                    {candidate.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.intro}>
          These are the places offered when you add something
          {place ? ` at ${place.name}` : ''}. Picking one is optional, so keep the
          list short enough to scan.
        </Text>

        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Add a tag</Text>
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
                  onPress={() => confirmRemove(tag)}
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

        <View style={styles.noteRow}>
          <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
          <Text style={styles.note}>
            Removing a tag leaves everything already filed under it alone.
          </Text>
        </View>

        {activeLocations.length === 0 && propertyId === activeProperty?.id ? (
          <Text style={styles.note}>
            Nothing is offered at capture right now — add at least one tag if you
            want the chips back.
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  places: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  placeActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  placeLabel: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textSecondary },
  placeLabelActive: { color: Colors.white, fontWeight: Typography.semibold },
  intro: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 20 },
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: {
    flex: 1,
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
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  note: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted },
});
