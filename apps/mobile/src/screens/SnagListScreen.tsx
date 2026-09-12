import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SnagCard from '../components/SnagCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { getSnags, getSnagPhotoUrls } from '../lib/supabase';
import { RootStackParamList, Snag, SnagFilter, SnagSort } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The four questions someone actually asks the list, as one row of chips.
 *
 * "Mine" and "Needs parts" are not status filters — they cut across status —
 * which is why this is a flat set rather than a status tab bar. A household
 * doesn't think in workflow states.
 */
type Lens = 'open' | 'mine' | 'parts' | 'done';

const LENSES: { key: Lens; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
  { key: 'open', label: 'To do', icon: 'ellipse-outline' },
  { key: 'mine', label: 'Mine', icon: 'person-outline' },
  { key: 'parts', label: 'Needs parts', icon: 'cart-outline' },
  { key: 'done', label: 'Done', icon: 'checkmark-circle-outline' },
];

export default function SnagListScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { profile, properties, activeProperty, setActiveProperty, locations } = useHousehold();

  const [lens, setLens] = useState<Lens>('open');
  const [room, setRoom] = useState<string | null>(null);
  const [snags, setSnags] = useState<Snag[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { filter, sort } = useMemo<{ filter: SnagFilter; sort: SnagSort }>(() => {
    // Scoped to one place when there is more than one; RLS already limits the
    // set to places this person is linked to.
    const base: SnagFilter = { room, propertyId: properties.length > 1 ? activeProperty?.id : null };
    switch (lens) {
      case 'mine':
        return { filter: { ...base, status: ['open', 'doing'], assigneeId: profile.id }, sort: 'priority' };
      case 'parts':
        return { filter: { ...base, status: ['open', 'doing'], needsParts: true }, sort: 'priority' };
      case 'done':
        return { filter: { ...base, status: ['done'] }, sort: 'newest' };
      default:
        return { filter: { ...base, status: ['open', 'doing'] }, sort: 'priority' };
    }
  }, [lens, room, profile.id, properties.length, activeProperty?.id]);

  const load = useCallback(async () => {
    try {
      const rows = await getSnags(filter, sort);
      setSnags(rows);
      // One request for every visible cover photo rather than one per card.
      const covers = rows.map((s) => s.photoPaths[0]).filter(Boolean) as string[];
      setPhotoUrls(await getSnagPhotoUrls(covers));
    } catch (err) {
      console.error('Failed to load snags:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, sort]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Coming back from the detail screen, where something may have been closed.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{properties.length > 1 ? activeProperty?.name ?? 'The list' : 'The list'}</Text>
        <Text style={styles.count}>
          {snags.length} {snags.length === 1 ? 'item' : 'items'}
        </Text>
      </View>

      {properties.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {properties.map((candidate) => {
            const active = activeProperty?.id === candidate.id;
            return (
              <Pressable
                key={candidate.id}
                onPress={() => setActiveProperty(candidate.id)}
                style={styles.chipTap}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.chip, active && styles.chipActive]}>
                  <Icon
                    name={active ? 'home' : 'home-outline'}
                    size="sm"
                    color={active ? Colors.white : Colors.textSecondary}
                  />
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {candidate.name}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {LENSES.map(({ key, label, icon }) => {
          const active = lens === key;
          return (
            <Pressable
              key={key}
              onPress={() => setLens(key)}
              style={styles.chipTap}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.chip, active && styles.chipActive]}>
                <Icon name={icon} size="sm" color={active ? Colors.white : Colors.textSecondary} />
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {locations.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.lastChipRow}
        >
          <Pressable
            onPress={() => setRoom(null)}
            style={styles.chipTap}
            accessibilityRole="button"
            accessibilityState={{ selected: !room }}
          >
            <View style={[styles.chip, !room && styles.chipActive]}>
              <Text style={[styles.chipLabel, !room && styles.chipLabelActive]}>Everywhere</Text>
            </View>
          </Pressable>
          {locations.map((location) => {
            const active = room === location.name;
            return (
              <Pressable
                key={location.id}
                onPress={() => setRoom(active ? null : location.name)}
                style={styles.chipTap}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {location.name}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        data={snags}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          snags.length === 0 && styles.listContentEmpty,
        ]}
        renderItem={({ item }) => (
          <SnagCard
            snag={item}
            photoUrl={item.photoPaths[0] ? photoUrls[item.photoPaths[0]] : null}
            onPress={() => navigation.navigate('SnagDetail', { snagId: item.id })}
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
          loading ? null : (
            <EmptyState
              icon={lens === 'done' ? 'checkmark-done-outline' : 'home-outline'}
              title={lens === 'done' ? 'Nothing finished yet' : 'Nothing on the list'}
              message={
                lens === 'parts'
                  ? 'Nothing is waiting on a trip to the hardware store.'
                  : lens === 'mine'
                    ? "Nothing is assigned to you."
                    : room
                      ? `Nothing outstanding in the ${room}.`
                      : 'Add something from the Add tab when you spot it.'
              }
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  title: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  count: { fontSize: Typography.sm, color: Colors.textMuted },
  // One chip, three rails.
  //
  // They used to be two shapes with two selected states: the lenses filled solid
  // fern, the rooms a pale tint with fern text, which read as two different
  // controls doing the same job. And both sat on white with a border — on a
  // plaster ground a white bordered box is a *card*, so a row of filters looked
  // like a row of things to read rather than a row of things to tap.
  //
  // Now: a sunken well when off, solid fern when on, no border either way.
  //
  // The tap area and the visible pill are deliberately different sizes. The pill
  // is ~34px because a rail of 48px lozenges is heavier than the list it filters;
  // the Pressable around it is the full MIN_TOUCH_TARGET, so the thing you can
  // hit is still 48. Both rails were under that before — 34px and 26px — which
  // is the part nobody notices until they are holding the phone one-handed.
  chipRow: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  lastChipRow: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, gap: Spacing.sm },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  chipActive: { backgroundColor: Colors.primary },
  chipLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  chipLabelActive: { color: Colors.white, fontWeight: Typography.semibold },
  listContent: { padding: Spacing.lg, paddingTop: 0, gap: Spacing.md },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
});
