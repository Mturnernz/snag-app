import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SectionList, TextInput, RefreshControl, Pressable, Modal, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ghostsForRoom, searchThings, type ThingInput } from '@snag/supabase-queries';
import ThingCard, { GhostCard } from '../components/ThingCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import AddThingSheet from '../components/AddThingSheet';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  createLocation, createThing, getAbsentThings, getSnagPhotoUrls, getThings, markThingAbsent,
  restoreAbsentThings,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import {
  AbsentThing, RootStackParamList, Thing, ThingGrouping, ThingKind, ThingSuggestion,
  THING_KINDS, THING_KIND_GROUP_LABELS,
} from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The house record — what's *there*, beside the list of what's wrong.
 *
 * **The tab arrives furnished.** Every room holds a greyed, dashed entry for
 * what a house of this kind probably has, until somebody records the real one.
 * That is the answer to the thing that kills every inventory product: an empty
 * record answers nothing, and a tab that answers nothing on the day it ships
 * never gets opened again.
 *
 * The rule the whole arrangement rests on, and the easiest one to erode: **a
 * ghost is not a row.** It comes from `ROOM_SUGGESTIONS`, a constant; it never
 * reaches `home.things`, never appears in a search result, and can never be
 * pointed at by a snag. A record full of entries nobody has confirmed *looks*
 * full and answers nothing, and that is worse than an empty one — you believe
 * it, check it in the shop, and find nothing there. If the ghost/real
 * distinction ever blurs, the furniture has to go rather than the distinction.
 *
 * Three consequences worth keeping:
 *
 * - **Progress is per room, never a percentage.** "Kitchen · 2 of 8" is a unit
 *   of work somebody can finish on a Saturday. A global completeness meter is
 *   the shaming number that gets an app closed and not reopened.
 * - **Ghosts appear under *By room* only.** By kind answers "what appliances do
 *   we have", and a thing nobody has confirmed is not one of them.
 * - **Dismissing is a tap; undoing it is a rescue.** The × means "no dryer
 *   here", and each room that has dismissals carries one line to bring them all
 *   back. A rescue that costs six taps is a dead end, which is the same reason
 *   `Elsewhere` is in the location seed.
 *
 * Adding is a **+** and a four-step walkthrough rather than the compose bar
 * capture uses. A snag is filed in ten seconds standing in front of the
 * problem; a thing is recorded at a workbench, or while a repairer reads a
 * model number out. The camera is still one tap — it is just step three now,
 * where it captures make, model, serial and date of manufacture at once.
 */

const GROUPINGS: { key: ThingGrouping; label: string }[] = [
  { key: 'room', label: 'By room' },
  { key: 'kind', label: 'By kind' },
];

/** Things that belong to the place rather than to a room in it. */
const NO_ROOM = 'Whole house';

type Row =
  | { row: 'thing'; key: string; thing: Thing }
  | { row: 'ghost'; key: string; room: string; suggestion: ThingSuggestion };

interface Section {
  title: string;
  room?: string;
  hidden?: number;
  isNew?: boolean;
  data: Row[];
}

export default function HouseScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const {
    household, properties, activeProperty, setActiveProperty, locations, reloadLocations,
  } = useHousehold();
  const { showToast } = useToast();

  const [grouping, setGrouping] = useState<ThingGrouping>('room');
  const [query, setQuery] = useState('');
  const [placesOpen, setPlacesOpen] = useState(false);

  const [things, setThings] = useState<Thing[]>([]);
  const [absent, setAbsent] = useState<AbsentThing[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [roomDraft, setRoomDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetStart, setSheetStart] =
    useState<{ room?: string | null; name?: string | null; kind?: ThingKind } | null>(null);

  const propertyId = activeProperty?.id ?? null;

  const load = useCallback(async () => {
    if (!propertyId) {
      setThings([]);
      setAbsent([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [rows, hidden] = await Promise.all([
        getThings(propertyId),
        getAbsentThings(propertyId),
      ]);
      setThings(rows);
      setAbsent(hidden);
      const covers = rows.map((t) => t.photoPaths[0]).filter(Boolean) as string[];
      setPhotoUrls(await getSnagPhotoUrls(covers));
    } catch (err) {
      console.error('Failed to load the house record:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [propertyId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Coming back from a spec sheet, where anything may have changed.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const visible = useMemo(() => searchThings(things, query), [things, query]);
  const searching = query.trim().length > 0;

  const sections = useMemo<Section[]>(() => {
    // A search is a flat answer over real records only. Grouping three results
    // across three headings buries the answer under its own filing, and a ghost
    // in a search result is the app offering something it does not have.
    if (searching) {
      return visible.length > 0
        ? [{
            title: `${visible.length} found`,
            data: visible.map((thing) => ({ row: 'thing' as const, key: thing.id, thing })),
          }]
        : [];
    }

    if (grouping === 'kind') {
      const out: Section[] = [];
      for (const kind of THING_KINDS) {
        const group = visible.filter((t) => t.kind === kind);
        if (group.length > 0) {
          out.push({
            title: `${THING_KIND_GROUP_LABELS[kind]} · ${group.length}`,
            data: group.map((thing) => ({ row: 'thing' as const, key: thing.id, thing })),
          });
        }
      }
      const other = visible.filter((t) => !THING_KINDS.includes(t.kind));
      if (other.length > 0) {
        out.push({
          title: `Everything else · ${other.length}`,
          data: other.map((thing) => ({ row: 'thing' as const, key: thing.id, thing })),
        });
      }
      return out;
    }

    // Seeded order, exactly as the list groups snags — the two tabs have to
    // describe the house in the same words and the same order, or the room a
    // snag is in and the room a thing is in stop reading as the same place.
    const order = locations.map((l) => l.name);
    const byRoom = new Map<string, Thing[]>();
    for (const thing of visible) {
      const room = thing.room ?? NO_ROOM;
      if (!byRoom.has(room)) byRoom.set(room, []);
      byRoom.get(room)!.push(thing);
    }

    const out: Section[] = [];
    const addRoom = (room: string) => {
      const recorded = byRoom.get(room) ?? [];
      // NO_ROOM is this screen's label for "belongs to the place, not a room in
      // it" — it is not a room and has no walls, so it is never furnished. It
      // would otherwise pick up the paint prompt every unknown room gets, and
      // tapping that would open the walkthrough asking which surface of
      // nowhere-in-particular it went on.
      const ghosts = room === NO_ROOM ? [] : ghostsForRoom(room, things, absent);
      if (recorded.length === 0 && ghosts.length === 0) return;

      const rows: Row[] = [
        ...recorded.map((thing) => ({ row: 'thing' as const, key: thing.id, thing })),
        ...ghosts.map((suggestion) => ({
          row: 'ghost' as const,
          key: `${room}:${suggestion.name}`,
          room,
          suggestion,
        })),
      ];
      const total = recorded.length + ghosts.length;
      out.push({
        // "2 of 8" and never a percentage: a per-room count is a unit of work
        // somebody can finish, and the denominator shrinks honestly as things
        // are dismissed rather than pretending the house is bigger than it is.
        title: ghosts.length > 0 ? `${room} · ${recorded.length} of ${total}` : `${room} · ${total}`,
        room,
        hidden: absent.filter((a) => a.room === room).length,
        data: rows,
      });
    };

    for (const room of order) addRoom(room);
    const extra = [...byRoom.keys()].filter((n) => !order.includes(n) && n !== NO_ROOM).sort();
    for (const room of extra) addRoom(room);
    if (byRoom.has(NO_ROOM)) addRoom(NO_ROOM);
    return out;
  }, [visible, things, absent, searching, grouping, locations]);

  const recorded = things.length;

  async function handleAdd(input: Omit<ThingInput, 'propertyId'>) {
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding to the house record.');
      return;
    }
    try {
      await createThing({ ...input, propertyId: activeProperty.id });
      setSheetOpen(false);
      showToast('In the record');
      await load();
    } catch (err: any) {
      // The sheet stays open on a failure: everything typed is still in it, and
      // the retry is the same button.
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
    }
  }

  /**
   * A thirteenth room — a conservatory, a study, a movie room.
   *
   * It writes to `home.locations`, which is the same list the List tab groups
   * by and capture offers, so a room added here is a room everywhere. That is
   * the point: rooms are a property's vocabulary, not this tab's, and two
   * places keeping separate ideas of what rooms exist is how the House tab and
   * the list stop describing the same house.
   *
   * A brand-new room has nothing catalogued for it, so it arrives holding the
   * one prompt every room in every house deserves — paint. Without that the
   * room would be invisible the moment it was created, since a section with
   * nothing in it is not drawn.
   */
  async function addRoom(name: string): Promise<boolean> {
    if (!propertyId) return false;
    try {
      await createLocation(propertyId, name);
      await reloadLocations();
      showToast(`${name} added`);
      return true;
    } catch (err: any) {
      // The RPC refuses a blank name and a duplicate in words, so this is worth
      // showing rather than swallowing.
      showAlert("Couldn't add that room", err?.message ?? 'Please try again.');
      return false;
    }
  }

  async function addRoomFromList() {
    const name = roomDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      if (await addRoom(name)) {
        setRoomDraft('');
        setRoomOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(room: string, suggestion: ThingSuggestion) {
    if (!propertyId) return;
    // Optimistic: the × is a small, certain, reversible act, and a card that
    // waits a round trip to disappear reads as a tap that did not land.
    setAbsent((current) => [...current, { propertyId, room, name: suggestion.name }]);
    try {
      await markThingAbsent(propertyId, room, suggestion.name);
    } catch (err: any) {
      setAbsent((current) => current.filter((a) => !(a.room === room && a.name === suggestion.name)));
      showAlert("Couldn't hide that", err?.message ?? 'Please try again.');
    }
  }

  async function restore(room: string) {
    if (!propertyId) return;
    try {
      await restoreAbsentThings(propertyId, room);
      setAbsent((current) => current.filter((a) => a.room !== room));
    } catch (err: any) {
      showAlert("Couldn't bring those back", err?.message ?? 'Please try again.');
    }
  }

  const placeName = properties.length > 1 ? activeProperty?.name ?? household.name : household.name;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => properties.length > 1 && setPlacesOpen(true)}
          disabled={properties.length < 2}
          style={styles.place}
          accessibilityRole={properties.length > 1 ? 'button' : undefined}
        >
          <Text style={styles.title}>{placeName}</Text>
          {properties.length > 1 ? (
            <Icon name="chevron-down" size="sm" color={Colors.textMuted} />
          ) : null}
        </Pressable>
      </View>

      {/* Above the grouping rail, not behind a magnifier: the moment this tab
          is opened for is a moment someone already knows what they want. */}
      <View style={styles.searchRow}>
        <Icon name="search" size="md" color={Colors.textMuted} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Make, model, colour, part…"
          placeholderTextColor={Colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search the house record"
        />
        {searching ? (
          <Pressable
            onPress={() => setQuery('')}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
          >
            <Icon name="close-circle-outline" size="md" color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {!searching ? (
        <View style={styles.rail}>
          {GROUPINGS.map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => setGrouping(key)}
              style={styles.chipTap}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: grouping === key }}
            >
              <View style={[styles.chip, grouping === key && styles.chipOn]}>
                <Text style={[styles.chipLabel, grouping === key && styles.chipLabelOn]}>
                  {label}
                </Text>
              </View>
            </Pressable>
          ))}
          {/* "Recorded", not "things": the ghosts on this screen are not things
              and counting them here would be the first place the two blur. */}
          <Text style={styles.count}>{recorded} recorded</Text>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[styles.listContent, sections.length === 0 && styles.listEmpty]}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.groupRow}>
            <Text style={styles.group}>{section.title}</Text>
            <View style={styles.groupRule} />
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.hidden ? (
            <Pressable
              onPress={() => section.room && restore(section.room)}
              style={styles.restore}
              accessibilityRole="button"
            >
              <Text style={styles.restoreLabel}>
                {section.hidden} not here · bring {section.hidden === 1 ? 'it' : 'them'} back
              </Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) =>
          item.row === 'thing' ? (
            <ThingCard
              thing={item.thing}
              photoUrl={item.thing.photoPaths[0] ? photoUrls[item.thing.photoPaths[0]] : null}
              onPress={() => navigation.navigate('ThingDetail', { thingId: item.thing.id })}
            />
          ) : (
            <GhostCard
              suggestion={item.suggestion}
              onPress={() => {
                // Tapping a ghost has already answered "which room" and "what
                // is it", so the walkthrough opens on the label.
                setSheetStart({
                  room: item.room === NO_ROOM ? null : item.room,
                  name: item.suggestion.name,
                  kind: item.suggestion.kind,
                });
                setSheetOpen(true);
              }}
              onDismiss={() => dismiss(item.room, item.suggestion)}
            />
          )
        }
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
        ListFooterComponent={
          !searching && grouping === 'room' && !loading ? (
            <Pressable
              onPress={() => setRoomOpen(true)}
              style={styles.addRoom}
              accessibilityRole="button"
              accessibilityLabel="Add a room"
            >
              <Icon name="add" size="sm" color={Colors.primary} />
              <Text style={styles.addRoomLabel}>Add a room</Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          loading ? null : searching ? (
            <EmptyState
              icon="search-outline"
              title="Nothing by that name"
              message="Try the make, the model number, or what it takes."
            />
          ) : (
            <EmptyState
              icon="home-outline"
              title="Nothing recorded yet"
              message="Add the heat pump, or the hallway paint. It is the thing you'll want in the shop."
            />
          )
        }
      />

      <Pressable
        onPress={() => {
          setSheetStart(null);
          setSheetOpen(true);
        }}
        style={[styles.fab, { bottom: Spacing.lg }]}
        accessibilityRole="button"
        accessibilityLabel="Add something to the house"
      >
        <Icon name="add" size="xl" color={Colors.white} />
      </Pressable>

      <AddThingSheet
        visible={sheetOpen}
        locations={locations}
        pathPrefix={household.id}
        start={sheetStart}
        onAddRoom={addRoom}
        onCancel={() => setSheetOpen(false)}
        onAdd={handleAdd}
      />

      <Modal visible={roomOpen} transparent animationType="slide" onRequestClose={() => setRoomOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRoomOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>Add a room</Text>
          <Text style={styles.sheetHint}>
            The twelve seeded tags are a starting point, not the vocabulary. A room added here
            joins the tags the list groups by and capture offers — it is not just for this tab.
          </Text>
          <TextInput
            style={styles.roomInput}
            value={roomDraft}
            onChangeText={setRoomDraft}
            placeholder="Conservatory · Study · Movie room"
            placeholderTextColor={Colors.textMuted}
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={addRoomFromList}
            accessibilityLabel="Name the room"
          />
          <Pressable
            onPress={addRoomFromList}
            disabled={busy || !roomDraft.trim()}
            style={[styles.cta, (busy || !roomDraft.trim()) && styles.ctaOff]}
            accessibilityRole="button"
            accessibilityLabel="Add the room"
          >
            <Text style={[styles.ctaLabel, (busy || !roomDraft.trim()) && styles.ctaLabelOff]}>
              Add the room
            </Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={placesOpen} transparent animationType="slide" onRequestClose={() => setPlacesOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPlacesOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>Which place</Text>
          {properties.map((property) => (
            <Pressable
              key={property.id}
              onPress={() => {
                setActiveProperty(property.id);
                setPlacesOpen(false);
              }}
              style={styles.placeRow}
              accessibilityRole="button"
              accessibilityState={{ selected: property.id === activeProperty?.id }}
            >
              <Icon
                name={property.id === activeProperty?.id ? 'radio-button-on' : 'radio-button-off'}
                size="md"
                color={property.id === activeProperty?.id ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.placeLabel,
                  property.id === activeProperty?.id && styles.placeLabelOn,
                ]}
              >
                {property.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  title: { fontSize: Typography.xxl, fontWeight: Typography.bold, color: Colors.textPrimary },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
  },
  search: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary, paddingVertical: Spacing.sm },
  clear: { padding: Spacing.xs },
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  count: { marginLeft: 'auto', fontSize: Typography.sm, color: Colors.textMuted },
  // Room for the + to float over without covering the last card.
  listContent: { padding: Spacing.lg, paddingBottom: Spacing.xxxl * 2, gap: Spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  group: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  groupRule: { flex: 1, height: 1, backgroundColor: Colors.border },
  restore: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  restoreLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  addRoom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingTop: Spacing.lg,
  },
  addRoomLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.primary },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.lg,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  sheetTitle: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  sheetHint: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19 },
  roomInput: {
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  cta: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Neutral when disabled, never faded: fern at half strength reads as broken
  // rather than as not-ready.
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.white },
  ctaLabelOff: { color: Colors.textMuted },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: MIN_TOUCH_TARGET },
  placeLabel: { fontSize: Typography.base, color: Colors.textSecondary },
  placeLabelOn: { color: Colors.textPrimary, fontWeight: Typography.semibold },
});
