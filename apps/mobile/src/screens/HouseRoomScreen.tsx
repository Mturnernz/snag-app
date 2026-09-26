import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  WHOLE_HOUSE, ghostsForRoom, thingKindGroups, thingsInArea,
} from '@snag/supabase-queries';
import ScreenHeader from '../components/ScreenHeader';
import ThingCard, { GhostCard } from '../components/ThingCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import AddThingSheet from '../components/AddThingSheet';
import { Group, SectionTitle, groupedStyles } from '../components/Grouped';
import { Colors, Spacing, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useAddThing } from '../hooks/useAddThing';
import { getAbsentThings, getFileUrls, getThings, markThingAbsent } from '../lib/supabase';
import { labelsToCheck } from '../lib/labelChecks';
import { showAlert } from '../lib/alert';
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
  const { properties, activeProperty } = useHousehold();

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

  const adding = useAddThing(load);

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
      </ScrollView>

      <AddThingSheet {...adding.sheet} />
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
  contentEmpty: { flexGrow: 1, justifyContent: 'center' },
});
