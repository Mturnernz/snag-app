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
import ComposeBar, { AmendLabel, AmendRow } from '../components/ComposeBar';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  createSnag, getSnagPhotoUrls, getSnags, markListSeen, updateSnag,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { RootStackParamList, Snag } from '../types';

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

type Lens = 'all' | 'mine' | 'parts' | 'urgent';
type Sort = 'room' | 'newest' | 'due';

const LENSES: { key: Lens; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'mine', label: 'Mine' },
  { key: 'parts', label: 'Needs parts' },
  { key: 'urgent', label: 'Urgent' },
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

  const [lens, setLens] = useState<Lens>('all');
  const [sort, setSort] = useState<Sort>('room');
  const [filterOpen, setFilterOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);

  const [snags, setSnags] = useState<Snag[]>([]);
  const [done, setDone] = useState<Snag[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /** Where the "New" rule sits. Captured once per visit, not per render. */
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<Snag | null>(null);
  const seenThisVisit = useRef(false);

  const propertyId = properties.length > 1 ? activeProperty?.id ?? null : null;

  const load = useCallback(async () => {
    try {
      const [open, finished] = await Promise.all([
        getSnags({ propertyId, status: ['open', 'doing'] }, sort === 'due' ? 'due' : 'newest'),
        // Small by construction — a household finishes a handful a week, and
        // only the last week of them is ever rendered.
        getSnags({ propertyId, status: ['done'] }, 'newest'),
      ]);
      setSnags(open);
      setDone(finished);

      // One request for every visible cover photo rather than one per card.
      const covers = [...open, ...finished].map((s) => s.photoPaths[0]).filter(Boolean) as string[];
      setPhotoUrls(await getSnagPhotoUrls(covers));
    } catch (err) {
      console.error('Failed to load snags:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [propertyId, sort]);

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

  const visible = useMemo(() => {
    switch (lens) {
      case 'mine': return snags.filter((s) => s.assigneeId === profile.id);
      case 'parts': return snags.filter((s) => s.needsParts);
      case 'urgent': return snags.filter((s) => s.priority === 'high');
      default: return snags;
    }
  }, [snags, lens, profile.id]);

  // What somebody else has put on the list since you last looked.
  const fresh = useMemo(() => {
    if (!seenBefore) return [];
    return visible.filter((s) => s.reporterId !== profile.id && s.createdAt > seenBefore);
  }, [visible, seenBefore, profile.id]);

  /**
   * The one trip that clears several jobs.
   *
   * This was the Weekend tab's best idea and the only thing lost when it went:
   * the reason a small job sits for a fortnight is usually a trip to the shop
   * nobody has made. It survives as the header of the "Needs parts" lens —
   * everything the visible jobs are waiting on, collected, with what it is for.
   */
  const shoppingList = useMemo(() => {
    if (lens !== 'parts') return [];
    return visible.flatMap((s) => s.parts.map((item) => ({ item, snag: s })));
  }, [lens, visible]);

  const recentlyDone = useMemo(() => {
    const cutoff = Date.now() - DONE_WINDOW_DAYS * 86_400_000;
    return done.filter((s) => new Date(s.doneAt ?? s.updatedAt).getTime() >= cutoff);
  }, [done]);

  const sections = useMemo(() => {
    const freshIds = new Set(fresh.map((s) => s.id));
    // Whatever is being prompted about stays at the top while the prompt is up.
    // Without this it sorts into its room — or, with no room yet, all the way
    // down to "Everywhere else" — so the thing you are being asked about is
    // off-screen behind the row asking about it.
    const pinned = justAdded ? visible.filter((s) => s.id === justAdded.id) : [];
    const pinnedId = pinned[0]?.id;
    const rest = visible.filter((s) => !freshIds.has(s.id) && s.id !== pinnedId);
    const out: { title: string; isNew?: boolean; data: Snag[] }[] = [];

    if (pinned.length > 0) out.push({ title: 'Just added', isNew: true, data: pinned });
    if (fresh.length > 0) {
      const others = fresh.filter((s) => s.id !== pinnedId);
      if (others.length > 0) out.push({ title: 'New', isNew: true, data: others });
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
        out.push({ title: `${name} · ${byRoom.get(name)!.length}`, data: byRoom.get(name)! });
      }
    } else if (rest.length > 0) {
      out.push({ title: sort === 'due' ? 'By when' : 'Everything else', data: rest });
    }

    if (showDone && recentlyDone.length > 0) {
      out.push({ title: 'Done this week', data: recentlyDone });
    }
    return out;
  }, [fresh, visible, sort, locations, showDone, recentlyDone, justAdded]);

  async function handleAdd(input: { photoPath: string | null; description: string | null }) {
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding something to the list.');
      return;
    }
    const snag = await createSnag({
      propertyId: activeProperty.id,
      description: input.description,
      photoPaths: input.photoPath ? [input.photoPath] : [],
      // Priority is not asked at capture any more. Nearly everything was filed
      // Low, and urgency is comparative — it belongs where twelve things are
      // visible at once. The amend row offers it for the case that isn't.
      priority: null,
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
  async function amend(update: Parameters<typeof updateSnag>[1], toast: string) {
    if (!justAdded) return;
    try {
      setJustAdded(await updateSnag(justAdded.id, update));
      showToast(toast);
      await load();
    } catch (err: any) {
      showAlert("Couldn't change that", err?.message ?? 'Please try again.');
    }
  }

  const since = describeSince(seenBefore);
  const placeName = properties.length > 1 ? activeProperty?.name ?? household.name : household.name;
  // A photo with no words and no room shows as "Something to sort out".
  const needsNote = !!justAdded && !justAdded.description;

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

      <Text style={styles.since}>
        {visible.length} to do
        {fresh.length > 0 && since ? ` · ${fresh.length} added ${since}` : ''}
      </Text>

      <SectionList
        sections={sections}
        ListHeaderComponent={
          shoppingList.length > 0 ? (
            <View style={styles.shopping}>
              <View style={styles.shoppingHead}>
                <Icon name="cart-outline" size="md" color={Colors.primary} />
                <Text style={styles.shoppingTitle}>Pick up on the way</Text>
              </View>
              <Text style={styles.shoppingHint}>
                One trip clears {visible.length} {visible.length === 1 ? 'job' : 'jobs'}.
              </Text>
              {shoppingList.map(({ item, snag }, index) => (
                <View key={`${snag.id}-${index}`} style={styles.shoppingRow}>
                  <Text style={styles.shoppingItem}>{item}</Text>
                  <Text style={styles.shoppingFor}>{snag.room ?? '—'}</Text>
                </View>
              ))}
            </View>
          ) : null
        }
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, sections.length === 0 && styles.listEmpty]}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.groupRow}>
            <Text style={[styles.group, section.isNew && styles.groupNew]}>{section.title}</Text>
            <View style={styles.groupRule} />
          </View>
        )}
        renderItem={({ item }) => (
          <SnagCard
            snag={item}
            photoUrl={item.photoPaths[0] ? photoUrls[item.photoPaths[0]] : null}
            onPress={() => navigation.navigate('SnagDetail', { snagId: item.id })}
          />
        )}
        ListFooterComponent={
          recentlyDone.length > 0 ? (
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
          ) : null
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
        <AmendRow>
          <View style={styles.amendHead}>
            <AmendLabel
              // Asks for what is still missing, and stops asking once it isn't.
              text={
                needsNote && !justAdded.room
                  ? 'On the list. What is it, and where?'
                  : needsNote
                    ? 'On the list. What is it?'
                    : justAdded.room
                      ? 'On the list.'
                      : 'On the list. Where is it?'
              }
            />
            <Pressable
              onPress={() => setJustAdded(null)}
              style={styles.amendDoneTap}
              accessibilityRole="button"
              accessibilityLabel="Finished adding"
            >
              <Text style={styles.amendDone}>Done</Text>
            </Pressable>
          </View>

          {/* Every room, not the first three: the one you want is the one you
              are standing in, and it is as likely to be the Roof as the
              Kitchen. Horizontal so twelve of them cost one row. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chips}
          >
            {locations.map((location) => {
              const on = justAdded.room === location.name;
              return (
                <Pressable
                  key={location.id}
                  onPress={() => amend({ room: on ? null : location.name }, on ? 'Tag removed' : location.name)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{location.name}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => amend({ priority: justAdded.priority === 'high' ? null : 'high' }, 'Marked urgent')}
              style={[styles.chip, justAdded.priority === 'high' && styles.chipAlert]}
              accessibilityRole="button"
              accessibilityState={{ selected: justAdded.priority === 'high' }}
            >
              <Text style={[styles.chipLabel, justAdded.priority === 'high' && styles.chipAlertLabel]}>
                Urgent
              </Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('SnagDetail', { snagId: justAdded.id })}
              style={styles.chip}
              accessibilityRole="button"
            >
              <Text style={styles.chipLabel}>More…</Text>
            </Pressable>
          </ScrollView>
        </AmendRow>
      ) : null}

      <ComposeBar
        pathPrefix={household.id}
        onAdd={handleAdd}
        // Only while the thing just added has no words of its own. A photo
        // taken after typing already carries them, and a typed snag is its own
        // description — asking again would be asking twice.
        note={needsNote ? { onSave: (text) => amend({ description: text }, 'Saved') } : undefined}
        stacked
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
  since: { fontSize: Typography.sm, color: Colors.textMuted, paddingHorizontal: Spacing.lg },
  listContent: { padding: Spacing.lg, gap: Spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
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
  shoppingFor: { fontSize: Typography.sm, color: Colors.textMuted },
  doneLine: { paddingVertical: Spacing.lg, alignItems: 'center' },
  doneText: { fontSize: Typography.sm, color: Colors.textMuted },
  amendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amendDoneTap: {
    minHeight: MIN_TOUCH_TARGET - Spacing.md,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  amendDone: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
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
