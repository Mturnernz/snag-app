import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { matchRooms } from '@snag/supabase-queries';
import { Location } from '../types';

interface Props {
  locations: Location[];
  /** The room as the snag holds it — TEXT, so a removed tag still reads back. */
  value: string | null;
  onChange: (room: string | null) => void;
  disabled?: boolean;
  /** Open on mount, for a step whose entire question is this. */
  startOpen?: boolean;
  /** What the closed field says when nothing is chosen. */
  placeholder?: string;
}

/**
 * Choosing a room, by typing as well as by looking.
 *
 * This replaced a rail of every room as a chip. The rail was right that **every
 * room is offered and not a shortlist** — the one you want is the one you are
 * standing in, and that is as likely to be the Roof as the Kitchen — and wrong
 * about what that costs once a household has added a conservatory, a study and
 * a storage area under the house to the seeded twelve. Sixteen chips is a wall
 * of grey that has to be *read* before it can be tapped, at the one moment the
 * app has about ten seconds of patience.
 *
 * Four things about it:
 *
 * - **The field says the answer, not the question.** Closed, it is one row
 *   holding the room's name — which is what somebody re-opening a job wants to
 *   see, and the reason this is a dropdown rather than a permanently expanded
 *   list.
 * - **Typing narrows, it does not filter to nothing.** `matchRooms` is the
 *   substring rule `matchSuggestions` already uses, so "house" finds *Under the
 *   house* — a prefix match would answer that with silence, and a picker that
 *   comes back empty for a room that exists is worse than no search at all.
 * - **A miss is not a dead end, and it is not an invitation either.** It says
 *   which rooms there are and where they are added. Making a room is
 *   `create_location` against a property and a `reloadLocations()` — the House
 *   tab and the project sheet both do it because somebody there is describing
 *   the place. Somebody filing a snag in ten seconds is not, and a half-made
 *   room is a worse outcome than a snag filed under Elsewhere.
 * - **Tapping the chosen room again clears it**, which is what the rail did.
 *   There is deliberately no separate "no room" row: `Elsewhere` is already the
 *   seed's escape hatch, and a second way to say *nowhere in particular* is two
 *   answers to one question.
 */
export default function RoomPicker({
  locations, value, onChange, disabled, startOpen, placeholder = 'Pick a room',
}: Props) {
  const [open, setOpen] = useState(!!startOpen);
  const [query, setQuery] = useState('');
  const field = useRef<TextInput>(null);

  const shown = useMemo(() => matchRooms(locations, query), [locations, query]);

  function choose(name: string) {
    onChange(value === name ? null : name);
    setQuery('');
    setOpen(false);
  }

  return (
    <View style={styles.wrap}>
      {/* Not rendered at all when the picker opens as its own step: a control
          whose only job is to open something that is already open is a control
          dressed as a choice. */}
      {startOpen ? null : (
        <Pressable
          onPress={() => {
            if (disabled) return;
            setOpen((was) => !was);
            setQuery('');
          }}
          disabled={disabled}
          style={[styles.field, disabled && styles.fieldOff]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open, disabled: !!disabled }}
          accessibilityLabel={value ? `Room: ${value}. Change it` : placeholder}
        >
          <Icon name="location-outline" size="sm" color={Colors.textMuted} />
          <Text
            style={[styles.fieldValue, !value && styles.fieldEmpty]}
            numberOfLines={1}
          >
            {value ?? placeholder}
          </Text>
          <Icon
            name={open ? 'chevron-up' : 'chevron-down'}
            size="sm"
            color={Colors.textMuted}
          />
        </Pressable>
      )}

      {open ? (
        <View style={styles.panel}>
          <View style={styles.searchRow}>
            <Icon name="search-outline" size="sm" color={Colors.textMuted} />
            <TextInput
              ref={field}
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              autoFocus={!startOpen}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search rooms"
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => { setQuery(''); field.current?.focus(); }}
                style={styles.clear}
                accessibilityRole="button"
                accessibilityLabel="Clear the search"
              >
                <Icon name="close" size="sm" color={Colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {shown.map((location) => {
              const on = value === location.name;
              return (
                <Pressable
                  key={location.id}
                  onPress={() => choose(location.name)}
                  disabled={disabled}
                  style={[styles.row, on && styles.rowOn]}
                  accessibilityRole="button"
                  accessibilityLabel={location.name}
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{location.name}</Text>
                  {on ? <Icon name="checkmark" size="sm" color={Colors.white} /> : null}
                </Pressable>
              );
            })}

            {shown.length === 0 ? (
              <Text style={styles.miss}>
                No room called “{query.trim()}”. Rooms are added on the House tab, or under
                Location tags on the You tab.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  fieldOff: { opacity: 0.6 },
  // minWidth 0 or a long room name pushes the chevron off the card — on web a
  // TextInput's neighbour in a flex row will not shrink below its intrinsic
  // width without it. Same trap the thing page's spec sheet paid for.
  fieldValue: { flex: 1, minWidth: 0, fontSize: Typography.base, color: Colors.textPrimary },
  fieldEmpty: { color: Colors.textMuted },
  panel: { gap: Spacing.sm },
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
  list: { maxHeight: 240 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.chip,
  },
  rowOn: { backgroundColor: Colors.primary },
  rowLabel: { fontSize: Typography.base, color: Colors.textPrimary },
  rowLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  miss: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
});
