import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';

import Icon from './Icon';
import Button from './Button';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { assetPickerOrder, searchThings, thingDetailLine, thingHeadline } from '@snag/supabase-queries';
import { Location, Thing } from '../types';

interface Props {
  visible: boolean;
  things: Thing[];
  loading?: boolean;
  /** Which are already linked when the sheet opens. */
  linkedIds: string[];
  /** The job's room, which is what the picker opens filtered to. */
  room: string | null;
  locations: Location[];
  busy?: boolean;
  onSave: (thingIds: string[]) => Promise<void> | void;
  onCancel: () => void;
}

/**
 * Choosing what a job is about, from the whole house record.
 *
 * **It replaced the record being printed onto the job's page.** Nine appliances
 * rendered inline read as nine things already attached to this snag, when what
 * they actually were was the room's inventory — an answer to a question nobody
 * had asked, costing a screen of vertical rent on a page people open
 * constantly. A list of what is *selected* belongs on the page; a list of what
 * *could be* belongs behind a control.
 *
 * Four things about it:
 *
 * - **Checkboxes, not chevrons.** The row's job here is to be chosen, and a
 *   chevron promises navigation. Tapping anywhere on the row toggles it, so the
 *   box is a statement of state rather than a small target to hit.
 * - **Nothing is written until Done.** Unlike the page behind it, where each
 *   control is its own decision, this is one question — which things — and a
 *   half-finished answer reaching the row is the thing `set_snag_things`
 *   replacing the whole set in one call exists to prevent.
 * - **It opens filtered to the job's room and says so**, because the room is
 *   already on the snag and is the best guess available. The filter is a chip
 *   that can be turned off rather than a rule, since houses are not laid out
 *   the way a catalogue thinks.
 * - **A ghost cannot appear.** `things` is `Thing[]`; a suggestion is a
 *   `RoomSuggestion` with no id, so a dashed prompt for a rangehood nobody has
 *   recorded can never be checked.
 */
export default function LinkAssetsSheet({
  visible, things, loading, linkedIds, room, locations, busy, onSave, onCancel,
}: Props) {
  const [chosen, setChosen] = useState<string[]>(linkedIds);
  const [query, setQuery] = useState('');
  /** `null` is "everywhere"; a string is one room. Opens on the job's room. */
  const [only, setOnly] = useState<string | null>(room);
  const keyboard = useKeyboardInset();

  // Re-seeded every time it opens, so a sheet dismissed without saving does not
  // hand its abandoned answer to the next opening.
  useEffect(() => {
    if (visible) {
      setChosen(linkedIds);
      setQuery('');
      setOnly(room);
    }
  }, [visible, room, linkedIds.join('|')]);

  const shown = useMemo(() => {
    const searched = searchThings(things, query);
    // A search reaches the whole house: somebody typing a model number has
    // named the thing precisely, and answering "not in the Kitchen" would be
    // the filter overruling the better signal.
    const scoped = query.trim() || !only
      ? searched
      : searched.filter((t) => (t.room ?? '').toLowerCase() === only.toLowerCase());
    return assetPickerOrder(scoped, linkedIds, room);
  }, [things, query, only, linkedIds.join('|'), room]);

  /** Rooms worth offering: ones this place actually has something recorded in. */
  const rooms = useMemo(() => {
    const has = new Set(things.map((t) => (t.room ?? '').toLowerCase()).filter(Boolean));
    return locations.filter((l) => has.has(l.name.toLowerCase()));
  }, [locations, things]);

  function toggle(id: string) {
    setChosen((was) => (was.includes(id) ? was.filter((one) => one !== id) : [...was, id]));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Close" />
      <View style={[styles.sheet, { marginBottom: keyboard }]}>
        <View style={styles.grab} />

        <View style={styles.head}>
          <Text style={styles.title}>Select assets</Text>
          <Text style={styles.count}>
            {chosen.length === 0 ? 'None selected' : `${chosen.length} selected`}
          </Text>
        </View>

        <View style={styles.searchRow}>
          <Icon name="search-outline" size="sm" color={Colors.textMuted} />
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Name, brand or model"
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search assets"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              style={styles.clear}
              accessibilityRole="button"
              accessibilityLabel="Clear the search"
            >
              <Icon name="close" size="sm" color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Hidden while searching: a room filter sitting over results that
            deliberately ignore it is a control that looks broken. */}
        {rooms.length > 1 && !query.trim() ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              onPress={() => setOnly(null)}
              style={[styles.chip, !only && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: !only }}
              accessibilityLabel="Everywhere"
            >
              <Text style={[styles.chipLabel, !only && styles.chipLabelOn]}>Everywhere</Text>
            </Pressable>
            {rooms.map((one) => {
              const on = !!only && only.toLowerCase() === one.name.toLowerCase();
              return (
                <Pressable
                  key={one.id}
                  onPress={() => setOnly(on ? null : one.name)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={one.name}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{one.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {loading ? (
            <ActivityIndicator style={styles.spinner} color={Colors.primary} />
          ) : null}

          {!loading && shown.length === 0 ? (
            <Text style={styles.miss}>
              {things.length === 0
                ? 'Nothing is recorded at this place yet. The House tab is where things are added.'
                : 'Nothing here matches that.'}
            </Text>
          ) : null}

          {shown.map((item) => {
            const on = chosen.includes(item.id);
            const detail = thingDetailLine(item);
            return (
              <Pressable
                key={item.id}
                onPress={() => toggle(item.id)}
                style={styles.row}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={thingHeadline(item)}
              >
                <Icon name="cube-outline" size="sm" color={Colors.textMuted} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={1}>{thingHeadline(item)}</Text>
                  {detail ? (
                    <Text style={styles.rowSpec} numberOfLines={1}>{detail}</Text>
                  ) : null}
                </View>
                {item.room ? <Text style={styles.rowRoom}>{item.room}</Text> : null}
                <Icon
                  name={on ? 'checkbox' : 'square-outline'}
                  size="md"
                  color={on ? Colors.primary : Colors.textMuted}
                />
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.actions}>
          <Button label="Cancel" variant="outline" onPress={onCancel} disabled={busy} />
          <Button
            label="Done"
            onPress={() => onSave(chosen)}
            loading={busy}
            fullWidth
            style={styles.done}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(43, 39, 36, 0.4)' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    maxHeight: '85%',
    ...Shadow.lg,
  },
  grab: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  count: { fontSize: Typography.sm, color: Colors.textMuted },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  search: { flex: 1, minWidth: 0, fontSize: Typography.base, color: Colors.textPrimary },
  clear: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.xs },
  chip: {
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    height: 34,
    borderRadius: Radius.chip,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  list: { maxHeight: 360 },
  spinner: { marginVertical: Spacing.lg },
  miss: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.xs,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: Typography.base, color: Colors.textPrimary },
  rowSpec: { fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textMuted },
  rowRoom: { fontSize: Typography.xs, color: Colors.textMuted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  done: { flex: 1 },
});
