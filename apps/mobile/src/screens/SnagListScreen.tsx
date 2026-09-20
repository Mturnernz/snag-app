import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, SectionList, ScrollView, RefreshControl, Pressable, Modal, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SnagCard from '../components/SnagCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import ComposeBar from '../components/ComposeBar';
import ExportFooter from '../components/ExportFooter';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import AmendSnagSheet from '../components/AmendSnagSheet';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  createSnag, getFileUrls, getSnags, getThings, markListSeen, setPartBought, updateSnag,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { readCollapsed, writeCollapsed } from '../lib/collapsed';
import {
  assessmentBrief, exportDateStamp, isDoneForNow, shoppingCount, shoppingList,
  snagExportPhotos, snagExportTable,
} from '@snag/supabase-queries';
import { loadExportImages, writeExport, type ExportFormat } from '../lib/exportFile';
import { RootStackParamList, Snag, Thing } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The list, and the app's home.
 *
 * There is no Add tab any more. Capture is the bar at the foot of this screen,
 * because capture was never a destination — it was a form that needed one — and
 * the cost of that arrangement was that the app opened on a form instead of on
 * what the other person had added.
 *
 * Which is the other half of the change. This product has no notifications and
 * deliberately never will (two people in one house do not need an email per
 * snag). So **this screen is the only channel by which one person finds out
 * what the other did**, and the first thing it says is what has arrived since
 * you last looked.
 *
 * Three consequences worth keeping:
 *
 * - **New is what someone *else* added since your last visit.** Your own
 *   entries are never news to you, and `mark_list_seen` returns the previous
 *   stamp rather than reading it separately, so the section can't empty itself
 *   out while you are reading it.
 * - **The rest groups by room**, which is how the work gets batched — you do
 *   the garage once — and which retires the twelve-chip room rail: you can see
 *   there are three things in the Garage without asking a filter.
 * - **Done leaves.** One muted line at the foot rather than a lens to select.
 *   Finishing something should make the list shorter; that is the whole reward
 *   the product has to offer.
 */

type Lens = 'all' | 'parts';
type Sort = 'room' | 'newest' | 'due';

// Two, where there were four. **Mine** read `assignee_id` and **Urgent** read
// `priority`, and nothing in the app writes either any more — a lens over a
// column nothing can set is a filter that comes back empty for ever and tells
// nobody why. What is left is the one that answers a question somebody actually
// arrives with: is there a trip to the shop in this.
const LENSES: { key: Lens; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'parts', label: 'Needs parts' },
];

const SORTS: { key: Sort; label: string }[] = [
  { key: 'room', label: 'By room' },
  { key: 'newest', label: 'Newest' },
  { key: 'due', label: 'Due' },
];

const NO_ROOM = 'Everywhere else';
const DONE_WINDOW_DAYS = 7;

/** "since Tuesday" for this week, a date once it stops being this week. */
function describeSince(iso: string | null): string | null {
  if (!iso) return null;
  const seen = new Date(iso);
  const days = Math.floor((Date.now() - seen.getTime()) / 86_400_000);
  if (days < 1) return 'since earlier today';
  if (days < 7) return `since ${seen.toLocaleDateString(undefined, { weekday: 'long' })}`;
  return `since ${seen.toLocaleDateString()}`;
}

export default function SnagListScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const {
    household, profile, properties, activeProperty, setActiveProperty, locations,
  } = useHousehold();
  const { showToast } = useToast();

  /**
   * Which sections are folded away, by key.
   *
   * Read once on mount and written on every change. Opens expanded whatever
   * happens — a storage read that fails, or a first run — because the first
   * thing this screen has to say is what the other person added, and a list
   * that opens folded says nothing at all until somebody unfolds it.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [lens, setLens] = useState<Lens>('all');
  const [sort, setSort] = useState<Sort>('room');
  const [filterOpen, setFilterOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);

  const [snags, setSnags] = useState<Snag[]>([]);
  const [done, setDone] = useState<Snag[]>([]);
  const [exporting, setExporting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /** Where the "New" rule sits. Captured once per visit, not per render. */
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<Snag | null>(null);
  const [amending, setAmending] = useState(false);
  /**
   * The house record, for the amend sheet's "is it about one of these?" step.
   *
   * **Fetched when a snag is filed, not when the list loads.** The list is the
   * screen people open constantly and this serves a sheet that only appears
   * after capture, so putting it in `load()` would spend a request on every
   * pull-to-refresh to answer a question nobody asked. Keyed by property, so
   * moving between the house and the bach re-reads rather than offering the
   * wrong place's appliances.
   */
  const [things, setThings] = useState<Thing[]>([]);
  const thingsFor = useRef<string | null>(null);
  const seenThisVisit = useRef(false);

  const propertyId = properties.length > 1 ? activeProperty?.id ?? null : null;
  /**
   * Projects off means the punch list goes too.
   *
   * A job filed against a renovation is reachable from that renovation's page,
   * and with the tab gone there is no page — so what is left on the list is a
   * row that names a job nothing can open. Asked of Postgres rather than
   * filtered here, so the header count, the shopping pill and both extracts get
   * the same answer rather than four subtractions that have to agree.
   */
  const excludeProjectSnags = !profile.projectsEnabled;

  const load = useCallback(async () => {
    try {
      const [open, finished] = await Promise.all([
        getSnags(
          { propertyId, excludeProjectSnags, status: ['open', 'doing'] },
          sort === 'due' ? 'due' : 'newest',
        ),
        // Small by construction — a household finishes a handful a week, and
        // only the last week of them is ever rendered.
        getSnags({ propertyId, excludeProjectSnags, status: ['done'] }, 'newest'),
      ]);
      setSnags(open);
      setDone(finished);

      // One request for every visible cover photo rather than one per card.
      const covers = [...open, ...finished].map((s) => s.photoPaths[0]).filter(Boolean) as string[];
      setPhotoUrls(await getFileUrls(covers));
    } catch (err) {
      console.error('Failed to load snags:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [propertyId, sort, excludeProjectSnags]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Coming back from a snag, where something may have been closed.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  // Stamp "seen" once, on the first visit of this mount. Doing it on every
  // focus would clear the New rule the moment somebody opened a snag and came
  // back — which is the one journey that starts from reading it.
  useEffect(() => {
    if (seenThisVisit.current) return;
    seenThisVisit.current = true;
    markListSeen().then(setSeenBefore);
  }, []);

  useEffect(() => {
    readCollapsed().then((keys) => setCollapsed(new Set(keys)));
  }, []);

  /** One place the fold is changed, so the device's copy can never fall behind. */
  const fold = useCallback((next: Set<string>) => {
    setCollapsed(next);
    void writeCollapsed([...next]);
  }, []);

  const visible = useMemo(() => {
    switch (lens) {
      case 'parts': return snags.filter((s) => s.needsParts);
      default: return snags;
    }
  }, [snags, lens]);

  /**
   * An extract of the list.
   *
   * "What's on screen" is the lens applied and the done section as it stands;
   * "Everything" is every open snag plus every done one, whatever the lens —
   * because an extract is an archive, and one that silently honoured a filter
   * set twenty minutes ago is one nobody could read correctly later.
   */
  async function handleExport(scope: ExportScope, format: ExportFormat, briefed: boolean) {
    setExporting(true);
    try {
      const rows = scope === 'all'
        ? [...snags, ...done]
        : [...visible, ...(showDone ? recentlyDone : [])];
      const scopeLabel = scope === 'all' ? 'Everything' : "What's on screen";
      const stamp = exportDateStamp();
      const place = activeProperty?.name ?? household.name;
      const table = snagExportTable(rows, {
        household: household.name,
        place,
        scope: scopeLabel,
        stamp,
      });
      // Photographs go in the PDF only — a spreadsheet cell cannot hold one,
      // and the PDF is the copy that gets sent to somebody who was not there.
      const images = format === 'pdf'
        ? await loadExportImages(snagExportPhotos(rows), getFileUrls)
        : [];
      // The brief names the scope the file was made under, and counts the
      // photographs that actually got in rather than the ones that were asked
      // for — a reader told there are twenty when four came is a reader who
      // thinks sixteen jobs have no photograph.
      const brief = briefed
        ? assessmentBrief({
          household: household.name,
          place,
          where: [activeProperty?.suburb, activeProperty?.town].filter(Boolean).join(', ') || null,
          scope: scopeLabel,
          stamp,
          rowCount: rows.length,
          photoCount: images.length,
        })
        : undefined;
      const { fileName, path } = await writeExport(table, format, images, brief);
      setShowExport(false);
      showToast(path ? `Saved to ${fileName}` : `${fileName} downloaded`);
    } catch (err: any) {
      showAlert("Couldn't make that file", err?.message ?? 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  // What somebody else has put on the list since you last looked.
  const fresh = useMemo(() => {
    if (!seenBefore) return [];
    return visible.filter((s) =>
      s.reporterId !== profile.id && s.createdAt > seenBefore && !isDoneForNow(s));
  }, [visible, seenBefore, profile.id]);

  /**
   * The one trip that clears several jobs.
   *
   * This was the Weekend tab's best idea and the only thing lost when it went:
   * the reason a small job sits for a fortnight is usually a trip to the shop
   * nobody has made. It survives as the header of the "Needs parts" lens —
   * everything the visible jobs are waiting on, collected, with what it is for.
   */
  const shopping = useMemo(
    () => (lens === 'parts' ? shoppingList(visible) : []),
    [lens, visible],
  );

  /**
   * How many things are still to get, across the whole list rather than the
   * lens — the pill is how somebody finds out there is shopping to do, so
   * counting only what a filter already reveals would answer a question nobody
   * could have asked yet.
   */
  const toGet = useMemo(() => shoppingCount(snags), [snags]);

  /**
   * Ticked at the shop.
   *
   * A local re-read rather than a full `load()`: the trip is a run of taps and
   * re-fetching two lists and every cover photo between each one would make the
   * card lag exactly where it is being used hardest.
   */
  async function tick(snagId: string, item: string, bought: boolean) {
    setSnags((current) => current.map((s) => (
      s.id === snagId
        ? { ...s, bought: bought ? [...s.bought, item] : s.bought.filter((i) => i !== item) }
        : s
    )));
    try {
      await setPartBought(snagId, item, bought);
    } catch (err: any) {
      showAlert("Couldn't tick that off", err?.message ?? 'Please try again.');
      load();
    }
  }

  const recentlyDone = useMemo(() => {
    const cutoff = Date.now() - DONE_WINDOW_DAYS * 86_400_000;
    return done.filter((s) => new Date(s.doneAt ?? s.updatedAt).getTime() >= cutoff);
  }, [done]);

  /**
   * What the header counts.
   *
   * A repeating job that has been done this cycle is not something to do, and
   * saying "3 to do" over a list where one of them is dimmed and parked at the
   * bottom is the screen contradicting itself.
   */
  const toDo = useMemo(() => visible.filter((s) => !isDoneForNow(s)).length, [visible]);

  /** Everything but whatever the amend sheet is asking about. */
  const rest0 = (rows: Snag[]) => (justAdded ? rows.filter((s) => s.id !== justAdded.id) : rows);

  const sections = useMemo(() => {
    const freshIds = new Set(fresh.map((s) => s.id));
    // Whatever is being prompted about stays at the top while the prompt is up.
    // Without this it sorts into its room — or, with no room yet, all the way
    // down to "Everywhere else" — so the thing you are being asked about is
    // off-screen behind the row asking about it.
    const pinned = justAdded ? visible.filter((s) => s.id === justAdded.id) : [];
    const pinnedId = pinned[0]?.id;
    // A repeating job that has been done sinks past every room to the foot of
    // the list. It cannot *leave* the way a finished snag does — the RPC rolls
    // it forward and leaves it open — so this is the only version of that
    // reward available to it, and leaving it sitting in its room means the one
    // thing on the list nobody has to think about is competing with the ones
    // they do. It comes back up on its own when the date arrives.
    const settled = rest0(visible).filter((s) => isDoneForNow(s));
    const settledIds = new Set(settled.map((s) => s.id));
    const rest = visible.filter((s) =>
      !freshIds.has(s.id) && s.id !== pinnedId && !settledIds.has(s.id));
    // A key that survives the count in the title changing, and the section
    // moving up or down the list as work is filed and finished. Folding by
    // index would fold whatever slid into that position.
    const out: { key: string; title: string; isNew?: boolean; data: Snag[] }[] = [];

    if (pinned.length > 0) out.push({ key: 'just-added', title: 'Just added', isNew: true, data: pinned });
    if (fresh.length > 0) {
      const others = fresh.filter((s) => s.id !== pinnedId);
      if (others.length > 0) out.push({ key: 'new', title: 'New', isNew: true, data: others });
    }

    if (sort === 'room') {
      // Seeded order first, so the rooms read the way the chips did, then
      // anything filed under a tag that has since been removed.
      const order = locations.map((l) => l.name);
      const byRoom = new Map<string, Snag[]>();
      for (const snag of rest) {
        const room = snag.room ?? NO_ROOM;
        if (!byRoom.has(room)) byRoom.set(room, []);
        byRoom.get(room)!.push(snag);
      }
      const known = order.filter((name) => byRoom.has(name));
      const extra = [...byRoom.keys()].filter((n) => !order.includes(n) && n !== NO_ROOM).sort();
      for (const name of [...known, ...extra, ...(byRoom.has(NO_ROOM) ? [NO_ROOM] : [])]) {
        out.push({
          key: `room:${name}`,
          title: `${name} · ${byRoom.get(name)!.length}`,
          data: byRoom.get(name)!,
        });
      }
    } else if (rest.length > 0) {
      out.push({
        key: 'rest',
        title: sort === 'due' ? 'By when' : 'Everything else',
        data: rest,
      });
    }

    if (settled.length > 0) {
      // The Schedule tab's words for the same fact, so the two screens do not
      // invent two names for one mechanism.
      out.push({ key: 'settled', title: `Comes round again · ${settled.length}`, data: settled });
    }

    if (showDone && recentlyDone.length > 0) {
      out.push({ key: 'done', title: 'Done this week', data: recentlyDone });
    }
    return out;
  }, [fresh, visible, sort, locations, showDone, recentlyDone, justAdded]);

  /**
   * The same sections, with the folded ones emptied rather than removed.
   *
   * The heading stays — that is the whole point of folding: "there are three
   * things in the Garage" is what the grouping exists to say, and a fold that
   * took the heading with it would be a filter rather than a fold. Emptying
   * `data` is also what keeps the fold free: `SectionList` renders no rows, so
   * a long list costs nothing to scroll past.
   */
  const shownSections = useMemo(
    () => sections.map((section) => (
      collapsed.has(section.key) ? { ...section, data: [] } : section
    )),
    [sections, collapsed]
  );

  /**
   * Whether the control at the top offers to open everything or shut it.
   *
   * It says the thing it will *do*, and it decides from whether anything is
   * still open — so the one press that is never a no-op is the one on offer.
   * With every section already folded it reads *Expand all*; with any section
   * open it reads *Collapse all*, which is what somebody scanning a long list
   * reaches for.
   */
  const anyOpen = useMemo(
    () => sections.some((section) => !collapsed.has(section.key)),
    [sections, collapsed]
  );

  async function handleAdd(input: { photoPath: string | null; description: string | null }) {
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding something to the list.');
      return;
    }
    const snag = await createSnag({
      propertyId: activeProperty.id,
      description: input.description,
      photoPaths: input.photoPath ? [input.photoPath] : [],
    });
    setJustAdded(snag);
    await load();
  }

  /**
   * The prompt after a photo.
   *
   * A photo on its own is the weakest thing this app can hold: with no words
   * and no room, `snagHeadline` has nothing to work with and the list shows
   * "Something to sort out" — which is unreadable a fortnight later, to the
   * person who filed it as much as to anyone else. So the moment after a photo
   * is the moment to ask, while the thing is still in front of you.
   *
   * It asks *after* the save, never before it. The snag is already on the list;
   * every one of these controls edits something that exists, so none of them
   * can block anybody and walking away leaves a perfectly good entry.
   */
  const loadThings = useCallback(async (placeId: string) => {
    if (thingsFor.current === placeId) return;
    try {
      const found = await getThings(placeId);
      thingsFor.current = placeId;
      setThings(found);
    } catch (err) {
      // The step simply does not appear. A capture sheet is not the place to
      // report that the house record could not be read.
      console.error('Failed to load the house record:', err);
    }
  }, []);

  async function amend(update: Parameters<typeof updateSnag>[1], toast: string) {
    if (!justAdded) return;
    setAmending(true);
    try {
      setJustAdded(await updateSnag(justAdded.id, update));
      showToast(toast);
      await load();
    } catch (err: any) {
      showAlert("Couldn't change that", err?.message ?? 'Please try again.');
    } finally {
      setAmending(false);
    }
  }

  const since = describeSince(seenBefore);
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

        {/* Only when there is something to get: at nought it is a control
            dressed as a choice, and the two filter rails were evicted from
            this screen for charging rent on every visit. Tapping it is the
            lens, not a second place parts live. */}
        {toGet > 0 ? (
          <Pressable
            onPress={() => setLens(lens === 'parts' ? 'all' : 'parts')}
            style={styles.shopTap}
            accessibilityRole="button"
            accessibilityLabel={`${toGet} ${toGet === 1 ? 'thing' : 'things'} to get`}
          >
            <View style={[styles.shopPill, lens === 'parts' && styles.shopPillOn]}>
              <Icon
                name="cart-outline"
                size="sm"
                color={lens === 'parts' ? Colors.white : Colors.textSecondary}
              />
              <Text style={[styles.shopCount, lens === 'parts' && styles.shopCountOn]}>
                {toGet}
              </Text>
            </View>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => setFilterOpen(true)}
          style={[styles.filterBtn, (lens !== 'all' || sort !== 'room') && styles.filterBtnOn]}
          accessibilityRole="button"
          accessibilityLabel="Show me"
        >
          <Icon
            name="options-outline"
            size="md"
            color={lens !== 'all' || sort !== 'room' ? Colors.white : Colors.textSecondary}
          />
        </Pressable>
      </View>

      {/* The count, and the one control that reaches every section at once.
          On the same line because both are *about* the list rather than in it,
          and because this screen has already evicted two filter rails for
          charging vertical rent on every visit — a row of its own for one
          control would be the third.

          It says what pressing it does and decides that from whether anything
          is still open, so the press on offer is never a no-op. */}
      <View style={styles.sinceRow}>
        <Text style={styles.since}>
          {toDo} to do
          {fresh.length > 0 && since ? ` · ${fresh.length} added ${since}` : ''}
        </Text>
        {sections.length > 1 ? (
          <Pressable
            onPress={() => fold(anyOpen ? new Set(sections.map((one) => one.key)) : new Set())}
            style={styles.foldAll}
            accessibilityRole="button"
            accessibilityLabel={anyOpen ? 'Collapse all' : 'Expand all'}
          >
            <Icon
              name={anyOpen ? 'chevron-up' : 'chevron-down'}
              size="sm"
              color={Colors.textMuted}
            />
            <Text style={styles.foldAllLabel}>{anyOpen ? 'Collapse all' : 'Expand all'}</Text>
          </Pressable>
        ) : null}
      </View>

      <SectionList
        sections={shownSections}
        ListHeaderComponent={
          shopping.length > 0 ? (
            <View style={styles.shopping}>
              <View style={styles.shoppingHead}>
                <Icon name="cart-outline" size="md" color={Colors.primary} />
                <Text style={styles.shoppingTitle}>Pick up on the way</Text>
              </View>
              <Text style={styles.shoppingHint}>
                One trip clears {visible.length} {visible.length === 1 ? 'job' : 'jobs'}.
              </Text>
              {/* A ticked row stays, struck through, rather than vanishing
                  under the finger that tapped it: otherwise undoing a mis-tap
                  means remembering which job the item belonged to. It leaves on
                  its own terms — a job with nothing left to get stops being
                  `needs_parts`, drops out of this lens, and takes its rows with
                  it, so the card empties as the trip ends. */}
              {shopping.map(({ item, snag, bought }) => (
                <Pressable
                  key={`${snag.id}-${item}`}
                  onPress={() => tick(snag.id, item, !bought)}
                  style={styles.shoppingRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: bought }}
                  accessibilityLabel={bought ? `${item}, got it` : `${item}, tick off`}
                >
                  <Icon
                    name={bought ? 'checkmark-circle' : 'ellipse-outline'}
                    size="sm"
                    color={bought ? Colors.primary : Colors.textMuted}
                  />
                  <Text style={[styles.shoppingItem, bought && styles.shoppingItemGot]}>
                    {item}
                  </Text>
                  <Text style={styles.shoppingFor}>{snag.room ?? '—'}</Text>
                </Pressable>
              ))}
            </View>
          ) : null
        }
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, sections.length === 0 && styles.listEmpty]}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => {
          const shut = collapsed.has(section.key);
          return (
            <Pressable
              onPress={() => {
                const next = new Set(collapsed);
                if (shut) next.delete(section.key); else next.add(section.key);
                fold(next);
              }}
              style={styles.groupRow}
              accessibilityRole="button"
              accessibilityState={{ expanded: !shut }}
              accessibilityLabel={`${section.title}, ${shut ? 'show' : 'hide'}`}
            >
              <Icon
                name={shut ? 'chevron-forward' : 'chevron-down'}
                size="sm"
                color={section.isNew ? Colors.primary : Colors.textMuted}
              />
              <Text style={[styles.group, section.isNew && styles.groupNew]}>{section.title}</Text>
              <View style={styles.groupRule} />
            </Pressable>
          );
        }}
        renderItem={({ item }) => (
          <SnagCard
            snag={item}
            photoUrl={item.photoPaths[0] ? photoUrls[item.photoPaths[0]] : null}
            onPress={() => navigation.navigate('SnagDetail', { snagId: item.id })}
          />
        )}
        ListFooterComponent={
          <>
            {recentlyDone.length > 0 ? (
              <Pressable
                onPress={() => setShowDone((v) => !v)}
                style={styles.doneLine}
                accessibilityRole="button"
                accessibilityState={{ expanded: showDone }}
              >
                <Text style={styles.doneText}>
                  {showDone ? 'Hide' : 'Show'} {recentlyDone.length} done this week
                </Text>
              </Pressable>
            ) : null}
            {/* At the foot of the scrolled content, never pinned to the bottom
                of the screen — that is the compose bar, and nothing goes on it. */}
            <ExportFooter label="Export this list" onPress={() => setShowExport(true)} />
            {/* The way back in, under the way out, because they are the two
                halves of one journey: a briefed PDF goes out here and the
                reply comes back here. Drawn the same muted way — neither is an
                action the screen is recommending. */}
            <ExportFooter
              label="Paste an assessment back in"
              icon="clipboard-outline"
              onPress={() => navigation.navigate('PasteAdvice')}
            />
          </>
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
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="home-outline"
              title={lens === 'all' ? 'Nothing needs doing' : 'Nothing here'}
              message={
                lens === 'all'
                  ? 'Next time you notice something, photograph it from here.'
                  : 'Nothing matches what you asked for.'
              }
            />
          )
        }
      />

      {justAdded ? (
        <AmendSnagSheet
          snag={justAdded}
          locations={locations}
          busy={amending}
          onSaveNote={(text) => amend({ description: text }, 'Added')}
          onSetRoom={(room) => amend({ room }, room ?? 'Tag removed')}
          onOpenDetail={() => {
            const id = justAdded.id;
            setJustAdded(null);
            navigation.navigate('SnagDetail', { snagId: id });
          }}
          onClose={() => setJustAdded(null)}
        />
      ) : null}

      {/* The bar files, and only files. It used to double as the note field
          for the snag just added, which is the thing nobody noticed: the
          placeholder changed and the meaning of the field changed with it.
          AmendSnagSheet asks for the note in words now. */}
      <ComposeBar pathPrefix={household.id} onAdd={handleAdd} stacked />

      <ExportSheet
        visible={showExport}
        what="the list"
        counts={{
          view: visible.length + (showDone ? recentlyDone.length : 0),
          all: snags.length + done.length,
        }}
        busy={exporting}
        canBrief
        onExport={handleExport}
        onCancel={() => setShowExport(false)}
      />

      {/* ─────────────────────────────────────────────── show me */}
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFilterOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>Show me</Text>
          <View style={styles.chips}>
            {LENSES.map(({ key, label }) => (
              <Pressable
                key={key}
                onPress={() => setLens(key)}
                style={[styles.chip, lens === key && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: lens === key }}
              >
                <Text style={[styles.chipLabel, lens === key && styles.chipLabelOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sheetLabel}>Sort</Text>
          <View style={styles.chips}>
            {SORTS.map(({ key, label }) => (
              <Pressable
                key={key}
                onPress={() => setSort(key)}
                style={[styles.chip, sort === key && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: sort === key }}
              >
                <Text style={[styles.chipLabel, sort === key && styles.chipLabelOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      {/* ─────────────────────────────────────────────── which place */}
      <Modal visible={placesOpen} transparent animationType="slide" onRequestClose={() => setPlacesOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPlacesOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>Which place</Text>
          {properties.map((candidate) => {
            const on = activeProperty?.id === candidate.id;
            return (
              <Pressable
                key={candidate.id}
                onPress={() => {
                  setActiveProperty(candidate.id);
                  setPlacesOpen(false);
                }}
                style={styles.placeRow}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Icon name={on ? 'home' : 'home-outline'} size="md" color={on ? Colors.primary : Colors.textSecondary} />
                <Text style={[styles.placeLabel, on && styles.placeLabelOn]}>{candidate.name}</Text>
              </Pressable>
            );
          })}
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
    gap: Spacing.sm,
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  title: { fontSize: Typography.xxl, fontWeight: Typography.bold, color: Colors.textPrimary },
  filterBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnOn: { backgroundColor: Colors.primary },
  // The app's one chip: a sunken well when off, solid fern when on, no border
  // either way. The pill is ~34px and the tap area is the full 48 — a rail of
  // lozenges outweighs the list it filters, and a 34px target is invisible
  // until somebody is holding the phone one-handed.
  shopTap: { minWidth: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, justifyContent: 'center' },
  shopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    height: 34,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  shopPillOn: { backgroundColor: Colors.primary },
  shopCount: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  shopCountOn: { color: Colors.white },
  since: { fontSize: Typography.sm, color: Colors.textMuted, paddingHorizontal: Spacing.lg },
  listContent: { padding: Spacing.lg, gap: Spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  sinceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  foldAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingLeft: Spacing.sm,
  },
  foldAllLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  // The whole heading is the tap target, so folding a room is the same gesture
  // wherever on the rule somebody happens to reach.
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  group: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  groupNew: { color: Colors.primary },
  groupRule: { flex: 1, height: 1, backgroundColor: Colors.border },
  // The only elevated surface on the screen, and only under one lens. It should
  // feel like the thing you opened the app for on the way out the door.
  shopping: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
    ...Shadow.md,
  },
  shoppingHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  shoppingTitle: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  shoppingHint: { fontSize: Typography.sm, color: Colors.textMuted, marginBottom: Spacing.xs },
  shoppingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  shoppingItem: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  shoppingItemGot: { color: Colors.textMuted, textDecorationLine: 'line-through' },
  shoppingFor: { fontSize: Typography.sm, color: Colors.textMuted },
  doneLine: { paddingVertical: Spacing.lg, alignItems: 'center' },
  doneText: { fontSize: Typography.sm, color: Colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET - Spacing.md,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipAlert: { backgroundColor: Colors.priority.highBg },
  chipLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  chipAlertLabel: { color: Colors.priority.high, fontWeight: Typography.semibold },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card + 6,
    borderTopRightRadius: Radius.card + 6,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  sheetTitle: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  sheetLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: MIN_TOUCH_TARGET },
  placeLabel: { fontSize: Typography.base, color: Colors.textSecondary },
  placeLabelOn: { color: Colors.textPrimary, fontWeight: Typography.semibold },
});
