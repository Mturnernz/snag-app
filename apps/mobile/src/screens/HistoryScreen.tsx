import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, SectionList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ScreenHeader from '../components/ScreenHeader';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import SignedImage from '../components/SignedImage';
import { Text, TextInput } from '../components/Text';
import { Colors, Fonts, MIN_TOUCH_TARGET, Radius, Spacing, Typography } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { getFileUrls, getSnags } from '../lib/supabase';
import {
  historyEntries, historyMonths, searchSnags, snagHeadline, type HistoryEntry,
} from '@snag/supabase-queries';
import type { RootStackParamList, Snag } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** "Wed 15 Oct", the local day, for a row. */
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Everything finished, by month — and searchable.
 *
 * The list keeps a finished job for seven days and then lets it go, which is
 * the reward for finishing: the list gets shorter. But "when did we last do
 * the gutters?" then had no answer short of hunting for a dot on the Schedule
 * tab. This is that answer: every finished job of the place being shown, the
 * newest month first, and each repeat at the last time it was done (a repeat
 * never reaches *done*; `set_snag_status` rolls it forward). The search is the
 * list's own, run on what is already in hand.
 *
 * **It is a read.** Nothing here writes; every row opens the job, where
 * *Reopen* is. Projects off means the punch list goes, as everywhere else.
 */
export default function HistoryScreen() {
  const navigation = useNavigation<Nav>();
  const { profile, activeProperty, properties } = useHousehold();
  const [done, setDone] = useState<Snag[]>([]);
  const [open, setOpen] = useState<Snag[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  const propertyId = properties.length > 1 ? activeProperty?.id ?? null : null;
  const excludeProjectSnags = !profile.projectsEnabled;

  const load = useCallback(async () => {
    try {
      const [finished, current] = await Promise.all([
        getSnags({ propertyId, excludeProjectSnags, status: ['done'] }, 'newest'),
        getSnags({ propertyId, excludeProjectSnags, status: ['open', 'doing'] }, 'newest'),
      ]);
      setDone(finished);
      setOpen(current.filter((s) => s.lastDoneAt));
      setFailed(false);
      const covers = [...finished, ...current].map((s) => s.photoPaths[0]).filter(Boolean) as string[];
      setPhotoUrls(covers.length ? await getFileUrls(covers) : {});
    } catch (err) {
      console.error('Failed to load history:', err);
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [propertyId, excludeProjectSnags]);

  useEffect(() => { void load(); }, [load]);

  const months = useMemo(() => {
    const entries = historyEntries(searchSnags(done, query), searchSnags(open, query));
    return historyMonths(entries).map((month) => ({
      key: month.key,
      title: month.label,
      data: month.entries,
    }));
  }, [done, open, query]);

  const count = months.reduce((n, month) => n + month.data.length, 0);
  const searching = query.trim().length > 0;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Finished" subtitle={properties.length > 1 ? activeProperty?.name : undefined} />
      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Icon name="search" size="md" color={Colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search what was done"
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search what was done"
          />
        </View>
      </View>
      <SectionList
        sections={months}
        keyExtractor={(entry: HistoryEntry) => `${entry.snag.id}-${entry.at}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.content, count === 0 && styles.contentEmpty]}
        keyboardShouldPersistTaps="handled"
        renderSectionHeader={({ section }) => (
          <Text style={styles.month} accessibilityRole="header">
            {`${section.title} · ${section.data.length}`}
          </Text>
        )}
        renderItem={({ item }) => {
          const url = item.snag.photoPaths[0] ? photoUrls[item.snag.photoPaths[0]] : null;
          return (
            <Pressable
              onPress={() => navigation.navigate('SnagDetail', { snagId: item.snag.id })}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${snagHeadline(item.snag)}, ${item.repeat ? 'last done' : 'done'} ${dayLabel(item.at)}`}
            >
              <View style={styles.thumb}>
                {url ? (
                  <SignedImage uri={url} style={styles.image} resizeMode="cover" />
                ) : (
                  <Icon name="checkmark-circle-outline" size="md" color={Colors.textMuted} />
                )}
              </View>
              <View style={styles.body}>
                <Text style={styles.headline} numberOfLines={2}>{snagHeadline(item.snag)}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[dayLabel(item.at), item.snag.room, item.repeat ? 'Comes round again' : null]
                    .filter(Boolean).join('  ·  ')}
                </Text>
              </View>
              <Icon name="chevron-forward" size="sm" color={Colors.chevron} />
            </Pressable>
          );
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />
        }
        ListEmptyComponent={loading ? null : failed ? (
          <EmptyState icon="alert-circle-outline" title="Couldn't load what was done" message="Pull down to try again." />
        ) : searching ? (
          <EmptyState icon="search" title={`Nothing done matches “${query.trim()}”`} message="Search looks at what each job says, its room, its parts and what it is linked to." />
        ) : (
          <EmptyState icon="checkmark-circle-outline" title="Nothing finished yet" message="A job ticked off on the list lands here, by month." />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.input,
    backgroundColor: Colors.well,
    minHeight: 44,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: Typography.body, color: Colors.textPrimary, paddingVertical: Spacing.sm },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl * 2 },
  contentEmpty: { flexGrow: 1, justifyContent: 'center' },
  month: {
    fontFamily: Fonts.mono,
    fontSize: Typography.label,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.hairline,
  },
  pressed: { opacity: 0.7 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: Radius.thumb,
    overflow: 'hidden',
    backgroundColor: Colors.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  headline: { fontSize: Typography.body, lineHeight: 22, fontWeight: Typography.semibold, color: Colors.textPrimary },
  meta: { fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textMuted },
});
