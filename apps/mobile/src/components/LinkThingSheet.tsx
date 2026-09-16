import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, ScrollView, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import Button from './Button';
import Icon from './Icon';
import { searchThings, thingDetailLine, thingHeadline } from '@snag/supabase-queries';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { Thing } from '../types';

interface Props {
  visible: boolean;
  things: Thing[];
  loading?: boolean;
  /** Which one it is already about, so the list can say so rather than repeat it. */
  linkedId?: string | null;
  onPick: (thingId: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}

/**
 * Saying what an existing snag is about.
 *
 * The capture sheet asks this seconds after the photo, offering **that room's**
 * things — short enough to be a two-second tag. This is the other moment: a
 * fortnight later, from the snag's own page, when somebody knows perfectly well
 * which appliance it was. So it offers the **whole** record and a search field,
 * because by now the room is not what narrows it — the noun is.
 *
 * **A ghost cannot be in here, and that is the type rather than a filter.**
 * `searchThings` takes `Thing[]`, and a suggestion is a constant with no id for
 * `snags.thing_id` to point at. If this list ever holds one, the House tab's
 * founding rule has been broken upstream.
 *
 * **Not recorded yet is not a dead end**, which is the same rule the
 * walkthrough's own picker follows: the foot of the sheet offers to create it,
 * and the sheet that opens is the walkthrough, not a second shorter form that
 * would produce a weaker record than the one the House tab insists on.
 */
export default function LinkThingSheet({
  visible, things, loading = false, linkedId, onPick, onCreate, onCancel,
}: Props) {
  const keyboard = useKeyboardInset();
  const [query, setQuery] = useState('');

  const results = useMemo(() => searchThings(things, query), [things, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, keyboard > 0 && { marginBottom: keyboard }]}>
          <Text style={styles.title}>What is it about?</Text>

          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Dishwasher, heat pump, the hallway paint…"
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            accessibilityLabel="Search the house record"
          />

          {loading ? <ActivityIndicator color={Colors.primary} /> : null}

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {results.map((thing) => {
              const detail = thingDetailLine(thing);
              const linked = thing.id === linkedId;
              return (
                <Pressable
                  key={thing.id}
                  onPress={() => onPick(thing.id)}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={thingHeadline(thing)}
                >
                  <Icon
                    name={linked ? 'checkmark-circle' : 'cube-outline'}
                    size="sm"
                    color={linked ? Colors.primary : Colors.textMuted}
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>{thingHeadline(thing)}</Text>
                    {/* The answer rather than the name: a model number is what
                        tells two dishwashers apart. */}
                    {detail ? (
                      <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.rowRoom}>{thing.room ?? 'Whole house'}</Text>
                </Pressable>
              );
            })}

            {!loading && results.length === 0 ? (
              <Text style={styles.empty}>
                {things.length === 0
                  ? 'Nothing is recorded at this place yet.'
                  : `Nothing here matches "${query.trim()}".`}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Button label="Create one instead" variant="outline" onPress={onCreate} fullWidth />
            <Button label="Cancel" variant="ghost" onPress={onCancel} fullWidth />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    gap: Spacing.sm,
    ...Shadow.lg,
  },
  title: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  input: {
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  list: { maxHeight: 260 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: Typography.base, color: Colors.textPrimary },
  rowDetail: { fontSize: Typography.xs, color: Colors.textMuted, fontFamily: Fonts.mono },
  rowRoom: { fontSize: Typography.xs, color: Colors.textMuted },
  empty: { fontSize: Typography.sm, color: Colors.textMuted, paddingVertical: Spacing.md },
  actions: { gap: Spacing.xs, marginTop: Spacing.xs },
});
