import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SnagCard from '../components/SnagCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
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
  const { profile, rooms } = useHousehold();

  const [lens, setLens] = useState<Lens>('open');
  const [room, setRoom] = useState<string | null>(null);
  const [snags, setSnags] = useState<Snag[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { filter, sort } = useMemo<{ filter: SnagFilter; sort: SnagSort }>(() => {
    const base: SnagFilter = { room };
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
  }, [lens, room, profile.id]);

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
        <Text style={styles.title}>The list</Text>
        <Text style={styles.count}>
          {snags.length} {snags.length === 1 ? 'item' : 'items'}
        </Text>
      </View>

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
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Icon name={icon} size="sm" color={active ? Colors.white : Colors.textSecondary} />
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {rooms.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roomRow}
        >
          <Pressable
            onPress={() => setRoom(null)}
            style={[styles.roomChip, !room && styles.roomChipActive]}
          >
            <Text style={[styles.roomLabel, !room && styles.roomLabelActive]}>Everywhere</Text>
          </Pressable>
          {rooms.map((name) => {
            const active = room === name;
            return (
              <Pressable
                key={name}
                onPress={() => setRoom(active ? null : name)}
                style={[styles.roomChip, active && styles.roomChipActive]}
              >
                <Text style={[styles.roomLabel, active && styles.roomLabelActive]}>{name}</Text>
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
              icon={lens === 'done' ? 'checkmark-done-outline' : 'happy-outline'}
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
  chipRow: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  chipLabelActive: { color: Colors.white },
  roomRow: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.sm },
  roomChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.chip,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  roomChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  roomLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  roomLabelActive: { color: Colors.primary, fontWeight: Typography.semibold },
  listContent: { padding: Spacing.lg, paddingTop: 0, gap: Spacing.md },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
});
