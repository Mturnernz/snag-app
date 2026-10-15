import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  WHOLE_HOUSE, ghostsForRoom, thingKindGroups, thingsInArea,
} from '@snag/supabase-queries';
import ScreenHeader from '../components/ScreenHeader';
import ThingCard, { GhostCard } from '../components/ThingCard';
import EmptyState from '../components/EmptyState';
import Sheet from '../components/Sheet';
import ConfirmDialog from '../components/ConfirmDialog';
import { Text, TextInput } from '../components/Text';
import Icon from '../components/Icon';
import AddThingSheet from '../components/AddThingSheet';
import { Group, SectionTitle, groupedStyles } from '../components/Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useAddThing } from '../hooks/useAddThing';
import { useOnReturn } from '../hooks/useOnReturn';
import {
  deleteLocation, getAbsentThings, getFileUrls, getThings, markThingAbsent, renameLocation,
} from '../lib/supabase';
import { labelsToCheck } from '../lib/labelChecks';
import { showAlert } from '../lib/alert';
import { RETURN_RELOAD_MS } from '../lib/foreground';
import type { AbsentThing, RootStackParamList, Thing, ThingSuggestion } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'HouseRoom'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * One room of the house record — what is in the Kitchen, and what probably is.
 *
 * Opened from its tile on the House tab, and a push rather than a sheet so a
 * thing's spec sheet can open over it and come back here rather than to the
 * grid. It reads the place's record rather than being handed a slice of it:
 * the room's things change under it whenever somebody records, moves or
 * removes one, and re-reading on focus is what keeps the page honest.
 *
 * **Grouped by kind only when there is more than one kind to tell apart.** A
 * room of nine appliances and one paint reads *Appliances* and *Paint and
 * finishes*; a hallway with one paint is just the paint. That is the rule the
 * Projects tab uses for its parts — a middle layer appears only when it earns
 * its place — and a heading over a single group is a heading pretending to be a
 * category. There is no control for it: this is how the room reads, not a
 * second layout.
 *
 * **What is not recorded yet is its own section, under the records and open.**
 * Those are ghosts: suggestions from a constant, never rows. Under a heading of
 * their own they cannot be read as part of the list above them, and a room with
 * nothing recorded still arrives furnished — its page is that section alone.
 * Tapping one opens the walkthrough on the label step, because it has already
 * answered which room and what it is; the × says this place hasn't got one,
 * and that is final.
 *
 * Whole house is the page for things that belong to the place rather than a
 * room in it. It has no walls, so it is never furnished.
 */
export default function HouseRoomScreen({ route }: Props) {
  const { room } = route.params;
  const navigation = useNavigation<Nav>();
  const { properties, activeProperty, locations, reloadLocations } = useHousehold();
  /** This room's tag, when the place still has one by this name. */
  const location = room === null ? null : locations.find((one) => one.name === room) ?? null;
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameProblem, setRenameProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const renameBusy = useRef(false);

  const [things, setThings] = useState<Thing[]>([]);
  const [absent, setAbsent] = useState<AbsentThing[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Things whose label reading waits on their page, marked on each row. Never fatal. */
  const [labelChecks, setLabelChecks] = useState<string[]>([]);

  const propertyId = activeProperty?.id ?? null;
  const name = room ?? WHOLE_HOUSE;

  const load = useCallback(async () => {
    if (!propertyId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [rows, hidden, checks] = await Promise.all([
        getThings(propertyId),
        getAbsentThings(propertyId),
        labelsToCheck(propertyId),
      ]);
      setThings(rows);
      setAbsent(hidden);
      setLabelChecks(checks);
      // Only this room's covers: signing every photograph in the house to draw
      // six thumbnails is a request whose cost grows with the wrong thing.
      const covers = thingsInArea(rows, room)
        .map((t) => t.photoPaths[0])
        .filter(Boolean) as string[];
      setPhotoUrls(covers.length > 0 ? await getFileUrls(covers) : {});
    } catch (err) {
      console.error('Failed to load the room:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [propertyId, room]);

  useEffect(() => {
    load();
  }, [load]);

  // Coming back from a spec sheet, where the thing may have moved room.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);
  // Back in the app after a while: read again, as a tab switch does. See
  // lib/foreground.ts — an installed web app comes back hours later as it was.
  useOnReturn(() => {
    if (navigation.isFocused?.() ?? true) load();
  }, RETURN_RELOAD_MS);

  const adding = useAddThing(load, room);

  const recorded = useMemo(() => thingsInArea(things, room), [things, room]);
  const groups = useMemo(() => thingKindGroups(recorded), [recorded]);
  const ghosts = useMemo(
    () => (room === null ? [] : ghostsForRoom(room, things, absent)),
    [room, things, absent],
  );

  /**
   * "No dryer here" — and that is the end of it. Optimistic, because a card
   * that waits a round trip to disappear reads as a tap that did not land; put
   * back if the server refuses it.
   */
  async function dismiss(suggestion: ThingSuggestion) {
    if (!propertyId || room === null) return;
    setAbsent((current) => [...current, { propertyId, room, name: suggestion.name }]);
    try {
      await markThingAbsent(propertyId, room, suggestion.name);
    } catch (err: any) {
      setAbsent((current) => current.filter((a) => !(a.room === room && a.name === suggestion.name)));
      showAlert("Couldn't hide that", err?.message ?? 'Please try again.');
    }
  }

  const empty = !loading && recorded.length === 0 && ghosts.length === 0;

  /**
   * Renaming a room renames everything filed under it at this place — its
   * jobs, its things, what it hasn't got — in one call (`rename_location`), so
   * nothing goes on saying the old name. The box writes when it is left, on
   * Return or *Done*, and only when it says something new.
   */
  async function commitRename(): Promise<boolean> {
    if (!location || renameBusy.current) return false;
    const next = newName.trim();
    if (!next || next === location.name) {
      setRenaming(false);
      return true;
    }
    renameBusy.current = true;
    try {
      await renameLocation(location.id, next);
      await reloadLocations();
      setRenaming(false);
      navigation.setParams({ room: next });
      return true;
    } catch (err: any) {
      // Held open with the words still there, rather than closing over a name
      // it did not take.
      setRenameProblem(err?.message ?? "Couldn't rename that room");
      return false;
    } finally {
      renameBusy.current = false;
    }
  }

  /**
   * Removing a room stops it being offered — to capture, to the walkthrough,
   * to a job's room picker. It does not rewrite what is filed under it: a job
   * logged in the Sleepout still says Sleepout, because rooms are text so that
   * history survives. The dialog says which.
   */
  async function remove() {
    if (!location) return;
    setRemoving(false);
    try {
      await deleteLocation(location.id);
      await reloadLocations();
      if (recorded.length === 0) navigation.goBack();
    } catch (err: any) {
      showAlert("Couldn't remove that room", err?.message ?? 'Please try again.');
    }
  }

  return (
    <View style={groupedStyles.screen}>
      <ScreenHeader
        title={name}
        // Which place, only once there is more than one: a one-house household
        // never meets the concept.
        subtitle={properties.length > 1 ? activeProperty?.name : undefined}
        rightSlot={
          <Pressable
            // `null` is a choice, not an absence: Whole house was picked, so the
            // walkthrough opens on "what is it" rather than asking the room.
            onPress={() => adding.open({ room })}
            style={styles.add}
            accessibilityRole="button"
            accessibilityLabel={`Add something to ${name}`}
          >
            <Icon name="add" size={26} color={Colors.primary} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={[groupedStyles.content, empty && styles.contentEmpty]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={Colors.primary}
          />
        }
      >
        {groups.map((group) => (
          <View key={group.key} style={groupedStyles.block}>
            {groups.length > 1 ? (
              <SectionTitle title={group.title} count={group.things.length} />
            ) : null}
            <Group>
              {group.things.map((thing) => (
                <ThingCard
                  key={thing.id}
                  thing={thing}
                  photoUrl={thing.photoPaths[0] ? photoUrls[thing.photoPaths[0]] : null}
                  labelToCheck={labelChecks.includes(thing.id)}
                  onPress={() => navigation.navigate('ThingDetail', { thingId: thing.id })}
                />
              ))}
            </Group>
          </View>
        ))}

        {ghosts.length > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="Not recorded yet" count={ghosts.length} />
            <View style={styles.ghosts}>
              {ghosts.map((suggestion) => (
                <GhostCard
                  key={suggestion.name}
                  suggestion={suggestion}
                  onPress={() => adding.open({ room, name: suggestion.name, kind: suggestion.kind })}
                  onDismiss={() => dismiss(suggestion)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {empty ? (
          <EmptyState
            icon="home-outline"
            title="Nothing recorded here"
            message="The + at the top adds the first thing."
          />
        ) : null}

        {/* The room itself: renamed or taken away here, where it is shown.
            Quiet, at the foot, and only for a room the place still has. */}
        {location ? (
          <View style={styles.roomActions}>
            <Pressable
              onPress={() => { setNewName(location.name); setRenameProblem(null); setRenaming(true); }}
              style={styles.roomAction}
              accessibilityRole="button"
              accessibilityLabel={`Rename ${location.name}`}
            >
              <Icon name="pencil-outline" size="sm" color={Colors.textSecondary} />
              <Text style={styles.roomActionLabel}>Rename this room</Text>
            </Pressable>
            <Pressable
              onPress={() => setRemoving(true)}
              style={styles.roomAction}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${location.name}`}
            >
              <Icon name="trash-outline" size="sm" color={Colors.danger} />
              <Text style={[styles.roomActionLabel, styles.roomActionDanger]}>Remove this room</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Sheet
        visible={renaming}
        title="Rename this room"
        subtitle="Its jobs and things move with it."
        closeLabel="Done"
        onClose={() => { void commitRename(); }}
      >
        <TextInput
          value={newName}
          onChangeText={(text) => { setNewName(text); setRenameProblem(null); }}
          onSubmitEditing={() => { void commitRename(); }}
          onBlur={() => { if (renaming) void commitRename(); }}
          autoFocus
          maxLength={40}
          returnKeyType="done"
          style={styles.renameBox}
          accessibilityLabel="The room's name"
        />
        {renameProblem ? <Text style={styles.renameProblem}>{renameProblem}</Text> : null}
      </Sheet>

      <ConfirmDialog
        visible={removing}
        title={`Remove ${location?.name ?? 'this room'}?`}
        message={recorded.length > 0
          ? `It won't be offered for new jobs or things. The ${recorded.length === 1 ? 'thing' : `${recorded.length} things`} here, and any job filed in ${location?.name}, keep the name, so this page stays while they are here.`
          : `It won't be offered for new jobs or things. Any job filed in ${location?.name} keeps the name.`}
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(false)}
        onConfirm={() => { void remove(); }}
      />

      <AddThingSheet {...adding.sheet} recorded={things} />
    </View>
  );
}

const styles = StyleSheet.create({
  add: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghosts: { gap: Spacing.sm },
  roomActions: { marginTop: Spacing.xxl, gap: Spacing.xs },
  roomAction: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: MIN_TOUCH_TARGET,
  },
  roomActionLabel: { fontSize: Typography.subhead, color: Colors.textSecondary },
  roomActionDanger: { color: Colors.danger },
  renameBox: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.input,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.body,
    color: Colors.textPrimary,
  },
  renameProblem: { fontSize: Typography.sm, color: Colors.danger, marginTop: Spacing.sm },
  contentEmpty: { flexGrow: 1, justifyContent: 'center' },
});
