import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, RefreshControl, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import {
  describeHouseRoom, exportDateStamp, houseRooms, placeTitle, searchThings, thingExportPhotos,
  thingExportTable, type HouseRoom,
} from '@snag/supabase-queries';
import ThingCard from '../components/ThingCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import AddThingSheet from '../components/AddThingSheet';
import AddRoomSheet from '../components/AddRoomSheet';
import ExportFooter from '../components/ExportFooter';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import { AddRow, Group, Pill, SectionTitle, Segmented, groupedStyles } from '../components/Grouped';
import Fab from '../components/Fab';
import HomePickerSheet from '../components/HomePickerSheet';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useAddThing } from '../hooks/useAddThing';
import { useOnReturn } from '../hooks/useOnReturn';
import { useFirstCapture } from '../hooks/useFirstCapture';
import { getAbsentThings, getFileUrls, getThings } from '../lib/supabase';
import { labelsToCheck } from '../lib/labelChecks';
import { showAlert } from '../lib/alert';
import { RETURN_RELOAD_MS } from '../lib/foreground';
import { loadExportImages, writeExport, type ExportFormat } from '../lib/exportFile';
import { roomIcon } from '../lib/roomIcon';
import { readHouseView, writeHouseView, type HouseView } from '../lib/houseView';
import { TILE_SCRIM, tileInk } from '../lib/tileInk';
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
 * - **No completeness number anywhere** — not a percentage, and since October
 *   2026 not a per-room "2 of 8" on the tile either. A completeness meter is
 *   the shaming number that gets an app closed and not reopened.
 * - **Recorded · All rooms.** The grid shows rooms holding something real by
 *   default; *All rooms* brings back the furnished ones. With nothing recorded
 *   it shows them all, so day one is still furnished.
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
    household, properties, activeProperty, locations,
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
  /**
   * Things with a label reading waiting on their page — one that landed after
   * *Add it*, or never landed. Read beside the record and never fatal: a count
   * nobody can fetch is a count of nought, which is also what it usually is.
   */
  const [labelChecks, setLabelChecks] = useState<string[]>([]);
  /** Recorded rooms only, or every room — remembered per device. */
  const [view, setView] = useState<HouseView>('recorded');
  useEffect(() => {
    let live = true;
    readHouseView().then((saved) => { if (live) setView(saved); });
    return () => { live = false; };
  }, []);
  function chooseView(next: HouseView) {
    setView(next);
    writeHouseView(next);
  }

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
      const [rows, hidden, checks] = await Promise.all([
        getThings(propertyId),
        getAbsentThings(propertyId),
        labelsToCheck(propertyId),
      ]);
      setThings(rows);
      setAbsent(hidden);
      setLabelChecks(checks);
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
  // Back in the app after a while: read again, as a tab switch does. See
  // lib/foreground.ts — an installed web app comes back hours later as it was.
  useOnReturn(() => {
    if (navigation.isFocused?.() ?? true) load();
  }, RETURN_RELOAD_MS);

  const adding = useAddThing(load);

  // The tour's *Try it* for the rooms or an appliance, sent here by the list.
  const firstCapture = useFirstCapture();
  useEffect(() => {
    if (!propertyId) return;
    const action = firstCapture.takeAction(['addRoom', 'addThing']);
    if (action === 'addRoom') setRoomOpen(true);
    else if (action === 'addThing') adding.open(null);
    // `adding` is re-made every render; the hand-off is taken exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, firstCapture]);

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

  const allRooms = useMemo(
    () => houseRooms(locations.map((l) => l.name), things, absent),
    [locations, things, absent],
  );

  /**
   * **Recorded** shows the rooms holding something real; **All rooms** adds
   * the ones that only hold suggestions. While nothing at all is recorded the
   * grid shows every room and offers no choice, so day one is still furnished:
   * an empty tab on the day it ships is the failure the furniture exists for.
   */
  const anyRecorded = allRooms.some((room) => room.recorded.length > 0);
  const rooms = useMemo(
    () => (view === 'recorded' && anyRecorded
      ? allRooms.filter((room) => room.recorded.length > 0)
      : allRooms),
    [allRooms, view, anyRecorded],
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
   * Another room — the ensuite, the second bedroom, or a conservatory.
   *
   * `AddRoomSheet` offers the rooms a house usually has and this one hasn't,
   * most common first, and a box for anything else. It writes to
   * `home.locations`, which is the same list the List tab groups by and capture
   * offers, so a room added here is a room everywhere. A room the catalogue has
   * nothing for still arrives holding the one prompt every room deserves —
   * paint — and gets a tile the moment it exists.
   */
  const roomNames = useMemo(() => locations.map((l) => l.name), [locations]);

  const placeName = placeTitle(activeProperty, properties);
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
          {anyRecorded ? (
            <Segmented
              options={[
                { value: 'recorded', label: 'Recorded' },
                { value: 'all', label: 'All rooms' },
              ]}
              value={view}
              onChange={chooseView}
              accessibilityLabel="Which rooms to show"
            />
          ) : null}
          {/* Absent at nought, like the shopping pill: a control with nothing
              behind it is a choice that isn't one. It opens the first thing
              with a reading waiting; each thing's row says so too. */}
          {labelChecks.length > 0 ? (
            <Pill
              label={labelChecks.length === 1 ? '1 label to check' : `${labelChecks.length} labels to check`}
              onPress={() => navigation.navigate('ThingDetail', { thingId: labelChecks[0] })}
            />
          ) : null}
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
                    labelToCheck={labelChecks.includes(thing.id)}
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

      <Fab onPress={() => adding.open(null)} accessibilityLabel="Add something to the house" />

      <AddThingSheet {...adding.sheet} recorded={things} />

      <ExportSheet
        visible={showExport}
        what="the house record"
        counts={{ view: visible.length, all: things.length }}
        busy={exporting}
        onExport={handleExport}
        onCancel={() => setShowExport(false)}
      />

      <AddRoomSheet
        visible={roomOpen}
        existing={roomNames}
        onAdd={adding.addRoom}
        onOpen={(room) => {
          // A room typed that is already here: open it, even when *Recorded*
          // is hiding it because nothing is in it yet.
          setRoomOpen(false);
          navigation.navigate('HouseRoom', { room });
        }}
        onClose={() => setRoomOpen(false)}
      />

      <HomePickerSheet visible={placesOpen} onClose={() => setPlacesOpen(false)} />
    </View>
  );
}

/**
 * How the list on a tile fades when the room holds more than it shows. The
 * fade is the "and more" — so it only happens
 * when something is cut off: fading a complete list would hide its last line
 * and claim there was more behind it.
 */
const TILE_FADE = [1, 0.85, 0.55, 0.25];

/**
 * One room, as a tile: an icon, its name and a short list.
 *
 * **Painted in the room's main wall colour** when a paint recorded there says
 * it went on the walls (`wallColour`), and white otherwise. That is the swatch
 * rule at full size rather than an exception to the palette: the colour is the
 * record's data, the same as the photograph of the tin, and a hex that does not
 * parse leaves the tile white rather than guessing. The words on it are
 * measured against the wall (`tileInk`) — ink or white, and a translucent panel
 * behind them for the mid-tones where neither reads. A painted tile carries a
 * hairline edge for the swatch dot's reason: most wall paint is a white, and
 * Alabaster on the plaster ground is otherwise a tile with no edge at all.
 *
 * **Records are solid bullets, suggestions hollow.** A room with nothing
 * recorded says *Not recorded yet* above its list, and its bullets are rings —
 * the Schedule tab's hollow-means-not-real, because a suggestion that reads as a
 * record is the one failure this tab is built against. Such a room is never
 * painted either: it has no paint to paint it with.
 *
 * **No count.** It said "2 of 8", which read as a score rather than as
 * anything a tile needed to say; the list under the name shows what is there.
 */
function RoomTile({ room, onPress }: { room: HouseRoom; onPress: () => void }) {
  const { lines, suggested, truncated, wall } = describeHouseRoom(room);
  const paint = wall ? tileInk(wall) : null;
  const ink = paint?.ink ?? Colors.textPrimary;
  // On a painted tile every line takes the measured colour: the muted and
  // secondary greys are measured against plaster and white, not against a wall.
  const quiet = paint ? ink : Colors.textSecondary;
  const muted = paint ? ink : Colors.textMuted;

  const content = (
    <>
      <View style={styles.tileHead}>
        <Text style={[styles.tileName, { color: ink }]} numberOfLines={2}>{room.name}</Text>
        <View
          style={styles.tileIcon}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name={roomIcon(room.room)} size="md" color={paint ? ink : Colors.textSecondary} />
        </View>
      </View>
      <View style={styles.tileList}>
        {suggested ? (
          <Text style={[styles.tileNote, { color: muted }]}>Not recorded yet</Text>
        ) : null}
        {lines.map((line, i) => (
          <View
            key={`${i}-${line}`}
            style={[styles.bulletRow, truncated && { opacity: TILE_FADE[i] ?? 0 }]}
          >
            <View
              style={
                suggested
                  ? [styles.bulletHollow, { borderColor: muted }]
                  : [styles.bullet, { backgroundColor: quiet }]
              }
            />
            <Text style={[styles.bulletText, { color: suggested ? muted : quiet }]} numberOfLines={1}>
              {line}
            </Text>
          </View>
        ))}
      </View>
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      style={[styles.tile, wall ? [styles.tilePainted, { backgroundColor: wall }] : null]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${room.name}`}
    >
      {paint?.scrim ? <View style={styles.tileScrim}>{content}</View> : content}
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
  // V2: the iOS large title, the same on every tab. It keeps its height while
  // empty, before the places load, so the header does not jump when they do.
  title: {
    fontSize: Typography.largeTitle, lineHeight: 41, minHeight: 41, fontWeight: Typography.bold,
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
  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
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
  // The wall colour's edge: ink at 10%, so it reads on Alabaster and vanishes
  // into a dark green rather than outlining it.
  tilePainted: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(43, 39, 36, 0.10)' },
  tileScrim: {
    gap: 6,
    margin: -Spacing.xs,
    padding: Spacing.sm,
    borderRadius: Radius.input,
    backgroundColor: TILE_SCRIM,
  },
  tileSpacer: { flex: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  tileName: {
    flex: 1, minWidth: 0,
    fontSize: Typography.body, lineHeight: 22, fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  // Centred on the name's first line (22pt line, 20pt glyph).
  tileIcon: { paddingTop: 1 },
  tileList: { gap: 3, paddingTop: 2 },
  tileNote: { fontSize: Typography.footnote, lineHeight: 18, color: Colors.textMuted },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  bullet: { width: 5, height: 5, borderRadius: 2.5 },
  bulletHollow: { width: 6, height: 6, borderRadius: 3, borderWidth: 1.25 },
  bulletText: { flex: 1, minWidth: 0, fontSize: Typography.footnote, lineHeight: 18 },
});
