import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SnagCard from '../components/SnagCard';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import Card from '../components/Card';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { getSnags, getSnagPhotoUrls } from '../lib/supabase';
import { planWeekend, snagHeadline, WeekendPlan } from '@snag/supabase-queries';
import { EFFORT_ORDER, RootStackParamList, SnagEffort, EFFORT_LABELS } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * "What can I get done today" — a different question from "what's outstanding",
 * and the reason the plain list isn't enough.
 *
 * Three things make it answerable rather than just another filter:
 *
 * - It's bounded by **time available**, not by importance. Someone with a free
 *   hour and someone with a free Saturday need different lists out of the same
 *   pile.
 * - It groups by **room**, because that's how the work is actually batched.
 *   You do the garage once.
 * - It pulls **needs-parts** out to the top as a shopping list. The trip to the
 *   hardware store is the single most common reason a small job stays undone
 *   for weeks, and one trip clears all of them.
 */
export default function WeekendScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();

  const [maxEffort, setMaxEffort] = useState<SnagEffort>('half_day');
  const [plan, setPlan] = useState<WeekendPlan | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await getSnags({ status: ['open', 'doing'], maxEffort }, 'priority');
      setPlan(planWeekend(rows));
      const covers = rows.map((s) => s.photoPaths[0]).filter(Boolean) as string[];
      setPhotoUrls(await getSnagPhotoUrls(covers));
    } catch (err) {
      console.error('Failed to build the weekend plan:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [maxEffort]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const empty = !loading && plan && plan.total === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.md }]}
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
      <Text style={styles.title}>Free weekend?</Text>
      <Text style={styles.subtitle}>
        {plan ? `${plan.total} ${plan.total === 1 ? 'job' : 'jobs'} you could pick up` : ' '}
      </Text>

      <Text style={styles.label}>How much time have you got?</Text>
      <View style={styles.effortRow}>
        {EFFORT_ORDER.map((effort) => {
          const active = maxEffort === effort;
          return (
            <Pressable
              key={effort}
              onPress={() => setMaxEffort(effort)}
              style={[styles.effortChip, active && styles.effortChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.effortLabel, active && styles.effortLabelActive]}>
                {EFFORT_LABELS[effort]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {empty ? (
        <EmptyState
          icon="beer-outline"
          title="Nothing to do"
          message="Everything that fits this much time is already done. Have the weekend off."
        />
      ) : null}

      {plan && plan.shoppingList.length > 0 ? (
        <Card elevation="md" style={styles.shopping}>
          <View style={styles.shoppingHeader}>
            <Icon name="cart-outline" size="md" color={Colors.primary} />
            <Text style={styles.shoppingTitle}>Pick up on the way</Text>
          </View>
          <Text style={styles.shoppingHint}>
            One trip clears {plan.shoppingList.length} of these.
          </Text>
          {plan.shoppingList.map((snag) => (
            <Pressable
              key={snag.id}
              onPress={() => navigation.navigate('SnagDetail', { snagId: snag.id })}
              style={styles.shoppingRow}
            >
              <Icon name="ellipse-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.shoppingText} numberOfLines={1}>
                {snagHeadline(snag)}
              </Text>
              {snag.room ? <Text style={styles.shoppingRoom}>{snag.room}</Text> : null}
            </Pressable>
          ))}
        </Card>
      ) : null}

      {plan?.byRoom.map(({ room, snags }) => (
        <View key={room} style={styles.roomSection}>
          <View style={styles.roomHeader}>
            <Text style={styles.roomTitle}>{room}</Text>
            <Text style={styles.roomCount}>{snags.length}</Text>
          </View>
          <View style={styles.roomList}>
            {snags.map((snag) => (
              <SnagCard
                key={snag.id}
                snag={snag}
                photoUrl={snag.photoPaths[0] ? photoUrls[snag.photoPaths[0]] : null}
                onPress={() => navigation.navigate('SnagDetail', { snagId: snag.id })}
              />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.xs },
  title: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  subtitle: { fontSize: Typography.base, color: Colors.textSecondary },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginTop: Spacing.lg,
  },
  effortRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  effortChip: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  effortChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  effortLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  effortLabelActive: { color: Colors.white },
  shopping: { marginTop: Spacing.xl, gap: Spacing.sm },
  shoppingHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  shoppingTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  shoppingHint: { fontSize: Typography.sm, color: Colors.textMuted },
  shoppingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  shoppingText: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  shoppingRoom: { fontSize: Typography.sm, color: Colors.textMuted },
  roomSection: { marginTop: Spacing.xl, gap: Spacing.sm },
  roomHeader: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  roomTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  roomCount: { fontSize: Typography.sm, color: Colors.textMuted },
  roomList: { gap: Spacing.md },
});
