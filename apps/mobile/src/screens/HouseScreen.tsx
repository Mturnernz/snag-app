import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, RefreshControl, Pressable, Modal, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import {
  describeHouseRoom, exportDateStamp, houseRooms, searchThings, thingExportPhotos,
  thingExportTable, type HouseRoom,
} from '@snag/supabase-queries';
import ThingCard from '../components/ThingCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import AddThingSheet from '../components/AddThingSheet';
import ExportFooter from '../components/ExportFooter';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import { AddRow, Group, SectionTitle, groupedStyles } from '../components/Grouped';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useAddThing } from '../hooks/useAddThing';
import { getAbsentThings, getFileUrls, getThings } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { loadExportImages, writeExport, type ExportFormat } from '../lib/exportFile';
import { AbsentThing, RootStackParamList, Thing } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The house record — what's *there*, beside the list of what's wrong.
 *
 * **A grid of rooms, each opening a page of its own** (`HouseRoomScreen`). It
 * was one long list with every room's records and suggestions inline, and a
 * house of a dozen rooms ran to two thousand pixels of scrolling with a fold
 * control to manage it. The rooms are the index now, and a room is where its
 * things are read.
 *
 * **The tab arrives furnished.** A room with nothing recorded still has a tile,
 * saying *Not recorded yet* and naming what a house of this kind probably has
 * there, and its page lists those suggestions under that heading. That is the
 * answer to the thing that kills every inventory product: an empty record
 * answers nothing, and a tab that answers nothing on the day it ships never
 * gets opened again.
 *
 * The rule the whole arrangement rests on, and the easiest one to erode: **a
 * ghost is not a row.** It comes from `ROOM_SUGGESTIONS`, a constant; it never
 * reaches `home.things`, never appears in a search result, and can never be
 * pointed at by a snag. A record full of entries nobody has confirmed *looks*
 * full and answers nothing, and that is worse than an empty one — you believe
 * it, check it in the shop, and find nothing there. If the ghost/real
 * distinction ever blurs, the furniture has to go rather than the distinction.
 *
 * Consequences worth keeping:
 *
 * - **Progress is per room, never a percentage.** "Kitchen · 2 of 8" is a unit
 *   of work somebody can finish on a Saturday. A global completeness meter is
 *   the shaming number that gets an app closed and not reopened.
 * - **The record is grouped by room and only by room.** Rooms are how somebody
 *   standing in a house thinks, and how the List tab groups; one layout means
 *   the two tabs cannot drift. Inside a room things are grouped by kind, but
 *   that is a heading, not a second layout, and there is no control for it.
 * - **A search is one flat answer over real records**, across every room.
 *
 * Adding is a **+** and a four-step walkthrough rather than the compose bar
 * capture uses. A snag is filed in ten seconds standing in front of the
 * problem; a thing is recorded at a workbench, or while a repairer reads a
 * model number out.
 */
export default function HouseScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useEdgeInsets();
  const {
    household, properties, activeProperty, setActiveProperty, locations,
  } = useHousehold();
  const { showToast } = useToast();

  const [query, setQuery] = useState('');
  const [placesOpen, setPlacesOpen] = useState(false);

  const [things, setThings] = useState<Thing[]>([]);
  const [absent, setAbsent] = useState<AbsentThing[]>([]);
  const [exporting, setExporting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [roomDraft, setRoomDraft] = useState('');
  const [busy, setBusy] = useState(false);

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
      // Covers for the search results, which are the only thing rows this
      // screen draws; a room's page signs its own.
      const covers = rows.map((t) => t.photoPaths[0]).filter(Boolean) as string[];
      setPhotoUrls(await getFileUrls(covers));
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

  // Coming back from a room, where anything may have been added or dismissed.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const adding = useAddThing(load);

  const visible = useMemo(() => searchThings(things, query), [things, query]);
  const searching = query.trim().length > 0;

  /**
   * An extract of the house record.
   *
   * "What's on screen" is whatever the search has narrowed to; "Everything" is
   * every recorded thing at this place. **Ghosts are in neither**, and that is
   * the tab's own rule rather than an omission: a suggestion never reaches
   * `home.things`, so a record full of them would be exactly the one you check
   * in a shop and find nothing behind.
   */
  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      const rows = scope === 'all' ? things : visible;
      const table = thingExportTable(rows, {
        household: household.name,
        place: activeProperty?.name ?? household.name,
        scope: scope === 'all' ? 'Everything' : "What's on screen",
        stamp: exportDateStamp(),
      });
      // Photographs go in the PDF only — a spreadsheet cell cannot hold one,
      // and a rating plate is most of what the record is for.
      const images = format === 'pdf'
        ? await loadExportImages(thingExportPhotos(rows), getFileUrls)
        : [];
      const { fileName, path } = await writeExport(table, format, images);
      setShowExport(false);
      showToast(path ? `Saved to ${fileName}` : `${fileName} downloaded`);
    } catch (err: any) {
      showAlert("Couldn't make that file", err?.message ?? 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  const rooms = useMemo(
    () => houseRooms(locations.map((l) => l.name), things, absent),
    [locations, things, absent],
  );

  /**
   * Two to a row, and a row is a pair rather than a wrapped flex line: a
   * percentage width with a gap cannot be expressed in React Native, and a lone
   * last tile must stay half width rather than stretching into a banner.
   */
  const pairs = useMemo(() => {
    const out: HouseRoom[][] = [];
    for (let i = 0; i < rooms.length; i += 2) out.push(rooms.slice(i, i + 2));
    return out;
  }, [rooms]);

  const recorded = things.length;

  /**
   * A thirteenth room — a conservatory, a study, a movie room.
   *
   * It writes to `home.locations`, which is the same list the List tab groups
   * by and capture offers, so a room added here is a room everywhere. A
   * brand-new room has nothing catalogued for it, so it arrives holding the one
   * prompt every room in every house deserves — paint — and gets a tile the
   * moment it exists.
   */
  async function addRoomFromList() {
    const name = roomDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      if (await adding.addRoom(name)) {
        setRoomDraft('');
        setRoomOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const placeName = properties.length > 1 ? activeProperty?.name ?? household.name : household.name;
  const empty = !loading && (searching ? visible.length === 0 : rooms.length === 0);

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

      {/* Above the rooms, not behind a magnifier: the moment this tab is
          opened for is a moment someone already knows what they want. */}
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

      {/* "Recorded", not "things": the ghosts behind the tiles are not things,
          and counting them here would be the first place the two blur. */}
      {!searching ? (
        <View style={styles.countRow}>
          <Text style={styles.count}>{recorded} recorded</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[groupedStyles.content, styles.content, empty && styles.contentEmpty]}
        keyboardShouldPersistTaps="handled"
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
        {loading ? null : searching ? (
          // A search is a flat answer over real records only. Grouping three
          // results across three rooms buries the answer under its own filing,
          // and a ghost in a search result is the app offering something it
          // does not have.
          visible.length > 0 ? (
            <View style={groupedStyles.block}>
              <SectionTitle title={`${visible.length} found`} />
              <Group>
                {visible.map((thing) => (
                  <ThingCard
                    key={thing.id}
                    thing={thing}
                    photoUrl={thing.photoPaths[0] ? photoUrls[thing.photoPaths[0]] : null}
                    onPress={() => navigation.navigate('ThingDetail', { thingId: thing.id })}
                  />
                ))}
              </Group>
            </View>
          ) : (
            <EmptyState
              icon="search-outline"
              title="Nothing by that name"
              message="Try the make, the model number, or what it takes."
            />
          )
        ) : rooms.length > 0 ? (
          <View style={styles.grid}>
            {pairs.map((pair) => (
              <View key={pair.map((room) => room.name).join('|')} style={styles.gridRow}>
                {pair.map((room) => (
                  <RoomTile
                    key={room.name}
                    room={room}
                    onPress={() => navigation.navigate('HouseRoom', { room: room.room })}
                  />
                ))}
                {pair.length === 1 ? <View style={styles.tileSpacer} /> : null}
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="home-outline"
            title="Nothing recorded yet"
            message="Add the heat pump, or the hallway paint. It is the thing you'll want in the shop."
          />
        )}

        {!loading && !searching ? (
          <AddRow label="Add a room" onPress={() => setRoomOpen(true)} />
        ) : null}
        {!loading ? (
          <ExportFooter label="Export the house record" onPress={() => setShowExport(true)} />
        ) : null}
      </ScrollView>

      <Pressable
        onPress={() => adding.open(null)}
        style={[styles.fab, { bottom: Spacing.lg }]}
        accessibilityRole="button"
        accessibilityLabel="Add something to the house"
      >
        <Icon name="add" size="xl" color={Colors.white} />
      </Pressable>

      <AddThingSheet {...adding.sheet} />

      <ExportSheet
        visible={showExport}
        what="the house record"
        counts={{ view: visible.length, all: things.length }}
        busy={exporting}
        onExport={handleExport}
        onCancel={() => setShowExport(false)}
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

/**
 * One room, as a tile: its name, the count, and what is in it.
 *
 * White on plaster with no outline and no shadow, like a V2 group — the tile
 * is a group of one row. The count is "2 of 8" while anything is still
 * suggested and a bare total after, and it goes muted while nothing is
 * recorded, because then the facts under it are suggestions and say so.
 */
function RoomTile({ room, onPress }: { room: HouseRoom; onPress: () => void }) {
  const { count, facts } = describeHouseRoom(room);
  const nothingYet = room.recorded.length === 0;
  return (
    <Pressable
      onPress={onPress}
      style={styles.tile}
      accessibilityRole="button"
      accessibilityLabel={`${room.name}, ${count}`}
    >
      <View style={styles.tileHead}>
        <Text style={styles.tileName} numberOfLines={2}>{room.name}</Text>
        <Text style={[styles.tileCount, nothingYet && styles.tileCountMuted]}>{count}</Text>
      </View>
      <Text style={styles.tileFacts} numberOfLines={3}>{facts}</Text>
    </Pressable>
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
  // V2: the iOS large title, the same on every tab.
  title: {
    fontSize: Typography.largeTitle, lineHeight: 41, fontWeight: Typography.bold,
    color: Colors.textPrimary, letterSpacing: -0.4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    // V2: the iOS search field — a sunken track, no outline.
    backgroundColor: Colors.segment,
    borderRadius: Radius.input,
  },
  search: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary, paddingVertical: Spacing.sm },
  clear: { padding: Spacing.xs },
  countRow: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  count: { fontSize: Typography.footnote, color: Colors.textMuted },
  // Room for the + to float over without covering the export line.
  content: { paddingBottom: Spacing.xxxl * 3 },
  contentEmpty: { flexGrow: 1, justifyContent: 'center' },
  grid: { gap: Spacing.md },
  gridRow: { flexDirection: 'row', gap: Spacing.md },
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 124,
    padding: Spacing.md + 2,
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
  },
  tileSpacer: { flex: 1 },
  tileHead: { gap: 2 },
  tileName: {
    fontSize: Typography.body, lineHeight: 22, fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  tileCount: {
    fontSize: Typography.subhead, lineHeight: 20, color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  tileCountMuted: { color: Colors.textMuted },
  tileFacts: { fontSize: Typography.footnote, lineHeight: 18, color: Colors.textMuted },
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
