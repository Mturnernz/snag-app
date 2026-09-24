import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SectionList, TextInput, RefreshControl, Pressable, Modal, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import {
  exportDateStamp, ghostsForRoom, searchThings, thingExportPhotos, thingExportTable,
  type ThingInput,
} from '@snag/supabase-queries';
import ThingCard, { GhostCard } from '../components/ThingCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import AddThingSheet from '../components/AddThingSheet';
import ExportFooter from '../components/ExportFooter';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import FoldAllPill from '../components/FoldAllPill';
import { readCollapsed, writeCollapsed } from '../lib/collapsed';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  createLocation, createThing, getAbsentThings, getFileUrls, getLabelReadingsToCheck, getThings,
  markThingAbsent,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { fileServiceJob } from '../lib/serviceJob';
import { loadExportImages, writeExport, type ExportFormat } from '../lib/exportFile';
import {
  AbsentThing, RootStackParamList, Thing, ThingKind, ThingSuggestion,
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
 * - **The record is grouped by room and only by room.** There was a By kind
 *   view beside it, and what it cost was a rail of two controls sitting over
 *   every visit to answer a question — "what appliances do we have" — that
 *   search already answers from the field above it. Rooms are how somebody
 *   standing in a house thinks, and how the List tab groups; one layout means
 *   the two tabs cannot drift.
 * - **Dismissing a suggestion is final.** The × means "no dryer here" and
 *   writes to `home.absent_things`, and that is the end of it: the prompt does
 *   not come back and nothing offers to bring it back. A room full of rescue
 *   lines for things somebody deliberately said were not there is clutter on
 *   the answer. The + still offers every kind the catalogue knows, so a dryer
 *   that does turn up is recorded the ordinary way.
 *
 * Adding is a **+** and a four-step walkthrough rather than the compose bar
 * capture uses. A snag is filed in ten seconds standing in front of the
 * problem; a thing is recorded at a workbench, or while a repairer reads a
 * model number out. The camera is still one tap — it is just step three now,
 * where it captures make, model, serial and date of manufacture at once.
 */

/** Things that belong to the place rather than to a room in it. */
const NO_ROOM = 'Whole house';

type Row =
  | { row: 'thing'; key: string; thing: Thing }
  | { row: 'ghost'; key: string; room: string; suggestion: ThingSuggestion };

interface Section {
  title: string;
  room?: string;
  data: Row[];
}

export default function HouseScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useEdgeInsets();
  const {
    household, properties, activeProperty, setActiveProperty, locations, reloadLocations,
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetStart, setSheetStart] =
    useState<{ room?: string | null; name?: string | null; kind?: ThingKind } | null>(null);
  /**
   * Things with a label reading waiting on their page — one that landed after
   * *Add it*, or never landed. Read beside the record and never fatal: a count
   * nobody can fetch is a count of nought, which is also what it usually is.
   */
  const [labelChecks, setLabelChecks] = useState<string[]>([]);

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
      try {
        const waiting = await getLabelReadingsToCheck(propertyId);
        // A reading still being read is not something to check yet.
        setLabelChecks(waiting.filter((one) => one.status !== 'pending').map((one) => one.thingId));
      } catch {
        setLabelChecks([]);
      }
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

  // Coming back from a spec sheet, where anything may have changed.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const visible = useMemo(() => searchThings(things, query), [things, query]);

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
  const searching = query.trim().length > 0;

  /**
   * Folded rooms, on their own key.
   *
   * Separate from the List tab's folds deliberately: folding the Garage away
   * here is a statement about the record you are reading, not about the jobs
   * filed in it, and one key would have each tab silently folding the other.
   * Per device for the same reason the list's are — this is where you are in a
   * list rather than a fact about the house — and every read and write is
   * guarded, so failure is always "everything is open".
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    readCollapsed('house').then((keys) => setCollapsed(new Set(keys)));
  }, []);
  const fold = useCallback((next: Set<string>) => {
    setCollapsed(next);
    void writeCollapsed([...next], 'house');
  }, []);

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
        data: rows,
      });
    };

    for (const room of order) addRoom(room);
    const extra = [...byRoom.keys()].filter((n) => !order.includes(n) && n !== NO_ROOM).sort();
    for (const room of extra) addRoom(room);
    if (byRoom.has(NO_ROOM)) addRoom(NO_ROOM);
    return out;
  }, [visible, things, absent, searching, locations]);

  /**
   * A folded room keeps its heading and empties its `data`, so `SectionList`
   * renders no rows under it — the same shape the List tab uses, so the two
   * behave identically. A search is one flat section with no room, and folds
   * never apply to it.
   */
  const shownSections = useMemo(
    () => sections.map((section) =>
      section.room && collapsed.has(section.title) ? { ...section, data: [] } : section
    ),
    [sections, collapsed],
  );

  /** Decides the pill's word, so the press on offer is never a no-op. */
  const anyOpen = useMemo(
    () => sections.some((section) => !!section.room && !collapsed.has(section.title)),
    [sections, collapsed],
  );

  const recorded = things.length;

  async function handleAdd(input: Omit<ThingInput, 'propertyId'>): Promise<boolean> {
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding to the house record.');
      return false;
    }
    try {
      const created = await createThing({ ...input, propertyId: activeProperty.id });
      setSheetOpen(false);
      showToast((await fileServiceJob(created)) ?? 'Added to the house');
      await load();
      return true;
    } catch (err: any) {
      // The sheet stays open on a failure: everything typed is still in it, and
      // the retry is the same button.
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
      return false;
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

  /**
   * "No dryer here" — and that is the end of it.
   *
   * There is no undo line under the room any more. A suggestion is a guess
   * about this house, saying it is wrong is a small certain fact, and a row of
   * rescue offers for guesses somebody has already corrected is clutter on top
   * of the answer. If a dryer does arrive, it is recorded with the + like
   * anything else the catalogue never guessed at.
   */
  async function dismiss(room: string, suggestion: ThingSuggestion) {
    if (!propertyId) return;
    // Optimistic: a card that waits a round trip to disappear reads as a tap
    // that did not land. The write is put back if the server refuses it.
    setAbsent((current) => [...current, { propertyId, room, name: suggestion.name }]);
    try {
      await markThingAbsent(propertyId, room, suggestion.name);
    } catch (err: any) {
      setAbsent((current) => current.filter((a) => !(a.room === room && a.name === suggestion.name)));
      showAlert("Couldn't hide that", err?.message ?? 'Please try again.');
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

      {/* All that is left of the grouping rail. "Recorded", not "things": the
          ghosts on this screen are not things, and counting them here would be
          the first place the two blur. */}
      {/* The count and the one control that reaches every room at once, on the
          same line: both are *about* the record rather than in it, and a row of
          its own for one control is vertical rent on every visit. Absent while
          searching, because a search is one flat answer with nothing to fold.

          Same component the List tab uses. Two tabs that group the same house
          by the same rooms in the same order must not grow two different
          controls for closing them. */}
      {!searching ? (
        <View style={styles.countRow}>
          <Text style={styles.count}>{recorded} recorded</Text>
          {/* Absent at nought, like the shopping pill: a control with nothing
              behind it is a choice that isn't one. It opens the first thing
              with a reading waiting; each card says so too. */}
          {labelChecks.length > 0 ? (
            <Pressable
              onPress={() => navigation.navigate('ThingDetail', { thingId: labelChecks[0] })}
              style={styles.checkTap}
              accessibilityRole="button"
              accessibilityLabel={`${labelChecks.length === 1 ? '1 label' : `${labelChecks.length} labels`} to check`}
            >
              <View style={styles.checkPill}>
                <Icon name="scan-outline" size="sm" color={Colors.textSecondary} />
                <Text style={styles.checkLabel}>
                  {labelChecks.length === 1 ? '1 label to check' : `${labelChecks.length} labels to check`}
                </Text>
              </View>
            </Pressable>
          ) : null}
          {sections.length > 1 ? (
            <FoldAllPill
              anyOpen={anyOpen}
              onPress={() =>
                fold(anyOpen ? new Set(sections.map((one) => one.title)) : new Set())
              }
            />
          ) : null}
        </View>
      ) : null}

      <SectionList
        sections={shownSections}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[styles.listContent, sections.length === 0 && styles.listEmpty]}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.groupRow}>
            {/* The heading folds; the + does not. A `Pressable` inside a
                `Pressable` is a coin toss about which one gets the tap — the
                same rule that keeps opening and removing siblings on a photo
                tile — so the word and the rule are the target and the + sits
                beside them rather than inside them.

                A folded room keeps its heading and its count, which is the
                whole point of grouping: "Kitchen · 2" is what the arrangement
                exists to say, and a fold that took it away would be a filter. */}
            <Pressable
              onPress={() => {
                if (!section.room) return;
                const next = new Set(collapsed);
                if (next.has(section.title)) next.delete(section.title);
                else next.add(section.title);
                fold(next);
              }}
              disabled={!section.room}
              style={styles.groupTap}
              accessibilityRole={section.room ? 'button' : undefined}
              accessibilityState={section.room ? { expanded: !collapsed.has(section.title) } : undefined}
              accessibilityLabel={section.room ? section.title : undefined}
            >
              {section.room ? (
                <Icon
                  name={collapsed.has(section.title) ? 'chevron-forward' : 'chevron-down'}
                  size="sm"
                  color={Colors.textMuted}
                />
              ) : null}
              <Text style={styles.group}>{section.title}</Text>
              <View style={styles.groupRule} />
            </Pressable>
            {/* Subtle on purpose: the ghosts below already say what this room
                probably has, and this is for the thing they didn't think of.
                Muted, small, and only under By room — a kind heading is not a
                place you can put something. */}
            {section.room ? (
              <Pressable
                onPress={() => {
                  // `null` here is a choice, not an absence: the walkthrough
                  // opens on "what is it" rather than asking the room again.
                  setSheetStart({ room: section.room === NO_ROOM ? null : section.room });
                  setSheetOpen(true);
                }}
                style={styles.groupAdd}
                accessibilityRole="button"
                accessibilityLabel={`Add something to ${section.room}`}
              >
                <Icon name="add" size="sm" color={Colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        )}
        renderItem={({ item }) =>
          item.row === 'thing' ? (
            <ThingCard
              thing={item.thing}
              photoUrl={item.thing.photoPaths[0] ? photoUrls[item.thing.photoPaths[0]] : null}
              labelToCheck={labelChecks.includes(item.thing.id)}
              onPress={() => navigation.navigate('ThingDetail', { thingId: item.thing.id })}
            />
          ) : (
            <GhostCard
              suggestion={item.suggestion}
              onPress={() => {
                // Tapping a ghost has already answered "which room" and "what
                // is it", so the walkthrough goes from the photo to the rest.
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
          !loading ? (
            <>
              {!searching ? (
                <Pressable
                  onPress={() => setRoomOpen(true)}
                  style={styles.addRoom}
                  accessibilityRole="button"
                  accessibilityLabel="Add a room"
                >
                  <Icon name="add" size="sm" color={Colors.primary} />
                  <Text style={styles.addRoomLabel}>Add a room</Text>
                </Pressable>
              ) : null}
              <ExportFooter
                label="Export the house record"
                onPress={() => setShowExport(true)}
              />
            </>
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
        onLateReading={(name, readable) => {
          showToast(readable ? `Read the label for ${name} — check it` : `Couldn't read the label for ${name}`);
          load();
        }}
      />

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
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  count: { fontSize: Typography.sm, color: Colors.textMuted },
  // The app's one pill: a sunken well, ~34px inside a 48px target.
  checkTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  checkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  checkLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  // Room for the + to float over without covering the last card.
  listContent: { padding: Spacing.lg, paddingBottom: Spacing.xxxl * 2, gap: Spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  // The whole rule is the fold target, so closing a room is the same gesture
  // wherever along it somebody happens to reach. The + is a sibling, never a
  // child.
  groupTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  // V2: a room is a section title in sentence case, not a caption in capitals.
  group: {
    fontSize: Typography.title3,
    fontWeight: Typography.semibold,
    letterSpacing: -0.3,
    color: Colors.textPrimary,
  },
  // V2: a section title stands on its own; the rule after it went with the capitals.
  groupRule: { flex: 1 },
  groupAdd: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  addRoom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingTop: Spacing.lg,
  },
  addRoomLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.primary },
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
