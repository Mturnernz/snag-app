import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SectionList, ScrollView, TextInput, RefreshControl, Pressable, Modal, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ThingCard from '../components/ThingCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import ComposeBar, { AmendLabel, AmendRow } from '../components/ComposeBar';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { searchThings } from '@snag/supabase-queries';
import { createThing, getSnagPhotoUrls, getThings, updateThing } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { RootStackParamList, Thing, ThingGrouping, THING_KINDS, THING_KIND_LABELS } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The house record — what's *there*, beside the list of what's wrong.
 *
 * The whole tab rests on one asymmetry, and every decision on this screen
 * follows from it: **writing happens rarely and by accident; reading happens
 * under mild pressure, almost never in the room the thing is in.** You record
 * the heat pump because a repairer happened to read its model number out loud.
 * You read it back eight months later, standing in a hardware aisle, needing
 * one exact string.
 *
 * So:
 *
 * - **Search is the primary control**, above everything and always visible.
 *   Every read moment starts with a half-remembered noun — "filter", "the
 *   green in the hallway" — and nobody in an aisle navigates a tree. It matches
 *   consumables too, so typing `GU10` lists every fitting that takes one.
 * - **Search runs on the list already in hand.** A house holds tens of things,
 *   not thousands; a round trip per keystroke would make the one moment this
 *   tab exists for the moment it is slowest, on the worst connection it will
 *   ever see.
 * - **Capture is the compose bar, unchanged.** Same camera in the same
 *   bottom-left corner, same save-then-ask amend row, same room chips in the
 *   same seeded order. A thing is a photograph of its label — the rating plate
 *   and the tin lid already *are* the record — so the photo files it and every
 *   question comes afterwards.
 *
 * What this screen is built against is specific: every house-inventory product
 * ever shipped opens on an empty thirty-field form, a house has four hundred
 * things in it, and the record ends up 8% complete. An 8% record is worse than
 * none, because you check it once, find nothing, and never check again. Hence
 * no required fields, and deliberately no completeness meter.
 */

const GROUPINGS: { key: ThingGrouping; label: string }[] = [
  { key: 'room', label: 'By room' },
  { key: 'kind', label: 'By kind' },
];

/** Things that belong to the place rather than to a room in it. */
const NO_ROOM = 'Whole house';

export default function HouseScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { household, properties, activeProperty, setActiveProperty, locations } = useHousehold();
  const { showToast } = useToast();

  const [grouping, setGrouping] = useState<ThingGrouping>('room');
  const [query, setQuery] = useState('');
  const [placesOpen, setPlacesOpen] = useState(false);

  const [things, setThings] = useState<Thing[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [justAdded, setJustAdded] = useState<Thing | null>(null);

  const propertyId = activeProperty?.id ?? null;

  const load = useCallback(async () => {
    if (!propertyId) {
      setThings([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const rows = await getThings(propertyId);
      setThings(rows);
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

  const sections = useMemo<{ title: string; isNew?: boolean; data: Thing[] }[]>(() => {
    // A search is a flat answer. Grouping a result of three across three
    // headings buries the answer under its own filing.
    if (searching) {
      return visible.length > 0 ? [{ title: `${visible.length} found`, data: visible }] : [];
    }

    const pinned = justAdded ? visible.filter((t) => t.id === justAdded.id) : [];
    const pinnedId = pinned[0]?.id;
    const rest = visible.filter((t) => t.id !== pinnedId);
    const out: { title: string; isNew?: boolean; data: Thing[] }[] = [];

    if (pinned.length > 0) out.push({ title: 'Just added', isNew: true, data: pinned });

    if (grouping === 'kind') {
      for (const kind of THING_KINDS) {
        const group = rest.filter((t) => t.kind === kind);
        if (group.length > 0) {
          out.push({ title: `${THING_KIND_LABELS[kind]} · ${group.length}`, data: group });
        }
      }
      const other = rest.filter((t) => !THING_KINDS.includes(t.kind));
      if (other.length > 0) out.push({ title: `Everything else · ${other.length}`, data: other });
      return out;
    }

    // Seeded order, exactly as the list groups snags — the two tabs have to
    // describe the house in the same words and the same order, or the room a
    // snag is in and the room a thing is in stop reading as the same place.
    const order = locations.map((l) => l.name);
    const byRoom = new Map<string, Thing[]>();
    for (const thing of rest) {
      const room = thing.room ?? NO_ROOM;
      if (!byRoom.has(room)) byRoom.set(room, []);
      byRoom.get(room)!.push(thing);
    }
    const known = order.filter((name) => byRoom.has(name));
    const extra = [...byRoom.keys()].filter((n) => !order.includes(n) && n !== NO_ROOM).sort();
    for (const name of [...known, ...extra, ...(byRoom.has(NO_ROOM) ? [NO_ROOM] : [])]) {
      out.push({ title: `${name} · ${byRoom.get(name)!.length}`, data: byRoom.get(name)! });
    }
    return out;
  }, [visible, searching, grouping, locations, justAdded]);

  /**
   * Capture. The photo is the record; the kind is a guess this row lets you
   * correct in one tap.
   *
   * `appliance` rather than asking first, because asking first is the thing
   * this whole arrangement exists to avoid — and because the amend row is
   * already up, already in front of you, and already editing something that is
   * safely saved.
   */
  async function handleAdd(input: { photoPath: string | null; description: string | null }) {
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding to the house record.');
      return;
    }
    const thing = await createThing({
      propertyId: activeProperty.id,
      kind: 'appliance',
      name: input.description,
      photoPaths: input.photoPath ? [input.photoPath] : [],
    });
    setJustAdded(thing);
    await load();
  }

  async function amend(update: Parameters<typeof updateThing>[1], toast: string) {
    if (!justAdded) return;
    try {
      setJustAdded(await updateThing(justAdded.id, update));
      showToast(toast);
      await load();
    } catch (err: any) {
      showAlert("Couldn't change that", err?.message ?? 'Please try again.');
    }
  }

  const placeName = properties.length > 1 ? activeProperty?.name ?? household.name : household.name;
  // A photo of a plate with no words is findable only by scrolling to it.
  const needsName = !!justAdded && !justAdded.name && !justAdded.model;

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
          is opened for is a moment someone already knows what they are looking
          for. */}
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
            <Icon name="close-circle" size="md" color={Colors.textMuted} />
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
              // Named on the Pressable rather than left to the nested Text: the
              // pill is a View wrapping a Text inside a tap target, and only
              // the outer node is what a screen reader lands on.
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
          <Text style={styles.count}>
            {things.length} {things.length === 1 ? 'thing' : 'things'}
          </Text>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, sections.length === 0 && styles.listEmpty]}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.groupRow}>
            <Text style={[styles.group, section.isNew && styles.groupNew]}>{section.title}</Text>
            <View style={styles.groupRule} />
          </View>
        )}
        renderItem={({ item }) => (
          <ThingCard
            thing={item}
            photoUrl={item.photoPaths[0] ? photoUrls[item.photoPaths[0]] : null}
            onPress={() => navigation.navigate('ThingDetail', { thingId: item.id })}
          />
        )}
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
              message="Photograph a rating plate or a paint tin lid. That is the whole record — the rest is optional."
            />
          )
        }
      />

      {justAdded ? (
        <AmendRow>
          <View style={styles.amendHead}>
            <AmendLabel
              text={
                needsName && !justAdded.room
                  ? 'In the record. What is it, and where?'
                  : needsName
                    ? 'In the record. What is it?'
                    : justAdded.room
                      ? 'In the record.'
                      : 'In the record. Where is it?'
              }
            />
            <Pressable
              onPress={() => navigation.navigate('ThingDetail', { thingId: justAdded.id })}
              style={styles.amendDoneTap}
              accessibilityRole="button"
            >
              <Text style={styles.amendDone}>Details</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chips}
          >
            {/* Capture guessed `appliance` rather than stopping to ask. One
                tap corrects it, on something already saved. */}
            {THING_KINDS.map((kind) => {
              const on = justAdded.kind === kind;
              return (
                <Pressable
                  key={kind}
                  onPress={() => !on && amend({ kind }, THING_KIND_LABELS[kind])}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                    {THING_KIND_LABELS[kind]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

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
                  onPress={() =>
                    amend({ room: on ? null : location.name }, on ? 'Tag removed' : location.name)
                  }
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{location.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => setJustAdded(null)}
            style={styles.amendClose}
            accessibilityRole="button"
          >
            <Text style={styles.amendDone}>Done</Text>
          </Pressable>
        </AmendRow>
      ) : null}

      <ComposeBar
        pathPrefix={household.id}
        onAdd={handleAdd}
        note={needsName ? { onSave: (text) => amend({ name: text }, 'Named') } : undefined}
        stacked
        words={{
          placeholder: 'Name it — “gas water heater”…',
          notePlaceholder: 'What is it?',
          cameraLabel: 'Photograph the label',
          sendLabel: 'Add to the record',
        }}
      />

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
  listContent: { padding: Spacing.lg, gap: Spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  group: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  groupNew: { color: Colors.primary },
  groupRule: { flex: 1, height: 1, backgroundColor: Colors.border },
  amendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amendDoneTap: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  amendClose: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'flex-end' },
  amendDone: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  // A chip's tap area and its visible pill are different sizes on purpose: a
  // rail of 48px lozenges outweighs the list it filters, so the pill stays
  // ~34px and the Pressable around it carries the touch target.
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: Spacing.sm, paddingRight: Spacing.lg },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
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
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: MIN_TOUCH_TARGET },
  placeLabel: { fontSize: Typography.base, color: Colors.textSecondary },
  placeLabelOn: { color: Colors.textPrimary, fontWeight: Typography.semibold },
});
