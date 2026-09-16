import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { Location, ProjectElement } from '../types';

interface Props {
  visible: boolean;
  locations: Location[];
  /** What the project is already made of, so a room cannot be added twice. */
  elements: ProjectElement[];
  /** Creates a room tag against the property, exactly as the start sheet does. */
  onAddRoom: (name: string) => Promise<boolean>;
  /** Adds a part of the job. `room` is null for a part that isn't a room. */
  onAdd: (name: string, room: string | null) => Promise<void>;
  onClose: () => void;
}

/**
 * Which rooms a project touches, after it has been started.
 *
 * Step two of the start sheet asks this once and then never again, which left
 * the answer frozen at the moment somebody was least sure of it — a renovation
 * grows a room more often than it loses one, and finding out the laundry is
 * coming in too is the normal middle of a job rather than a mistake.
 *
 * **It offers the rooms rather than a naming box**, which the first version of
 * this control got wrong: the + on *Parts of the job* opened a free-text field,
 * so adding the bathroom meant typing "Bathroom" and hoping it matched the tag
 * the rest of the app files things under. Rooms are a property's vocabulary and
 * a picker is the only control that cannot misspell it. A room already a part
 * is shown lit and inert, because adding it twice is two elements with one name
 * and no way to tell them apart.
 *
 * **The naming box stays, underneath, for the parts that are not rooms.** A
 * renovation has a *Consent and council* and a *Scaffolding* that belong to no
 * room at all, and a picker alone would insist otherwise.
 *
 * And `+ Add a room…` is here too, writing through `home.create_location` like
 * everywhere else — one vocabulary, or the tabs stop describing the same house.
 */
export default function ProjectRoomsSheet({
  visible, locations, elements, onAddRoom, onAdd, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [busy, setBusy] = useState(false);
  const [namingRoom, setNamingRoom] = useState(false);
  const [roomDraft, setRoomDraft] = useState('');
  const [partDraft, setPartDraft] = useState('');

  useEffect(() => {
    if (!visible) return;
    setNamingRoom(false);
    setRoomDraft('');
    setPartDraft('');
    setBusy(false);
  }, [visible]);

  const taken = new Set(
    elements.map((element) => (element.room ?? element.name).toLowerCase())
  );

  async function addRoom() {
    const name = roomDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      if (await onAddRoom(name)) {
        // Created and added in one gesture: somebody who types a room into a
        // sheet asking which rooms this job touches has answered the question,
        // and making them tap the chip they just made would be asking twice.
        await onAdd(name, name);
        setRoomDraft('');
        setNamingRoom(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function addPart() {
    const name = partDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onAdd(name, null);
      setPartDraft('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          styles.sheet,
          { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + Spacing.lg },
        ]}
      >
        <View style={styles.grab} />
        <View style={styles.head}>
          <Text style={styles.title}>Which rooms does it touch?</Text>
          <Pressable
            onPress={onClose}
            style={styles.headTap}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.chips}>
            {locations.map((location) => {
              const on = taken.has(location.name.toLowerCase());
              return (
                <Pressable
                  key={location.id}
                  onPress={() => !on && !busy && onAdd(location.name, location.name)}
                  disabled={on || busy}
                  style={styles.chipTap}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: on }}
                  accessibilityLabel={on ? `${location.name}, already part of this job` : location.name}
                >
                  <View style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{location.name}</Text>
                  </View>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setNamingRoom(true)}
              style={styles.chipTap}
              accessibilityRole="button"
              accessibilityLabel="Add a room"
            >
              <View style={[styles.chip, styles.chipNew]}>
                <Text style={styles.chipNewLabel}>+ Add a room…</Text>
              </View>
            </Pressable>
          </View>

          {namingRoom ? (
            <View style={styles.row}>
              <TextInput
                style={styles.input}
                value={roomDraft}
                onChangeText={setRoomDraft}
                placeholder="Storage area · Conservatory · Sleepout"
                placeholderTextColor={Colors.textMuted}
                onSubmitEditing={addRoom}
                returnKeyType="done"
                maxLength={40}
                autoFocus
                accessibilityLabel="Name the room"
              />
              <Pressable
                onPress={addRoom}
                disabled={busy || !roomDraft.trim()}
                style={styles.go}
                accessibilityRole="button"
                accessibilityLabel="Add it"
              >
                {busy ? (
                  <ActivityIndicator color={Colors.primary} />
                ) : (
                  <Icon
                    name="checkmark"
                    size="md"
                    color={roomDraft.trim() ? Colors.primary : Colors.textMuted}
                  />
                )}
              </Pressable>
            </View>
          ) : null}

          <Text style={styles.label}>Or a part that isn’t a room</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              value={partDraft}
              onChangeText={setPartDraft}
              placeholder="Consent and council · Scaffolding"
              placeholderTextColor={Colors.textMuted}
              onSubmitEditing={addPart}
              returnKeyType="done"
              maxLength={60}
              accessibilityLabel="Name a part that isn’t a room"
            />
            <Pressable
              onPress={addPart}
              disabled={busy || !partDraft.trim()}
              style={styles.go}
              accessibilityRole="button"
              accessibilityLabel="Add that part"
            >
              <Icon
                name="add"
                size="md"
                color={partDraft.trim() ? Colors.primary : Colors.textMuted}
              />
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Each one gets its own items and its own total. Removing a room is on the job itself,
            because what it holds goes with it.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '86%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  headTap: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Spacing.md,
  },
  scroll: { marginTop: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: Spacing.sm },
  chip: {
    backgroundColor: Colors.sunken,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  chipNew: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
  },
  chipNewLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.sm,
    color: Colors.textPrimary,
  },
  go: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: Spacing.lg,
  },
  hint: { fontSize: Typography.xs, color: Colors.textMuted, lineHeight: 17, marginTop: Spacing.md },
});
