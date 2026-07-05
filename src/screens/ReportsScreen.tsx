import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase, getOrgStats, OrgStats } from '../lib/supabase';
import {
  STATUS_LABELS, PRIORITY_LABELS, CATEGORY_LABELS,
  IssueStatus, IssuePriority, IssueCategory,
} from '../types';
import { Colors, Spacing, Typography } from '../constants/theme';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatBox({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card variant="elevated" style={styles.statBox}>
      <Text style={[styles.statValue, accent ? { color: accent } : undefined]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function BarRow({
  label, count, total, color,
}: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? count / total : 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={styles.barCount}>{count}</Text>
    </View>
  );
}

function statusColor(s: IssueStatus): string {
  const map: Record<IssueStatus, string> = {
    open: Colors.status.open,
    in_progress: Colors.status.inProgress,
    resolved: Colors.status.resolved,
    closed: Colors.status.closed,
  };
  return map[s];
}

function priorityColor(p: IssuePriority): string {
  const map: Record<IssuePriority, string> = {
    high: Colors.priority.high,
    medium: Colors.priority.medium,
    low: Colors.priority.low,
  };
  return map[p];
}

function categoryColor(c: IssueCategory): string {
  const map: Record<IssueCategory, string> = {
    niggle: Colors.category.niggle,
    broken_equipment: Colors.category.brokenEquipment,
    health_and_safety: Colors.category.healthAndSafety,
    other: Colors.category.other,
  };
  return map[c];
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('organisation_id, organisation:organisations(name)')
      .eq('id', user.id)
      .single();

    if (data?.organisation_id) {
      setOrgName((data.organisation as any)?.name ?? '');
      setStats(await getOrgStats(data.organisation_id));
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!stats) return null;

  const openRate = stats.totalIssues > 0
    ? Math.round((stats.byStatus.open / stats.totalIssues) * 100)
    : 0;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Reports" />
      {orgName ? <Text style={styles.headerSub}>{orgName}</Text> : null}

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}>

        {/* Summary row */}
        <View style={styles.summaryRow}>
          <StatBox label="Total Issues" value={stats.totalIssues} />
          <StatBox label="Members" value={stats.totalMembers} />
          <StatBox label="Open" value={stats.byStatus.open} accent={Colors.status.open} />
          <StatBox label="High" value={stats.byPriority.high} accent={Colors.priority.high} />
        </View>

        {/* Open rate callout */}
        {stats.totalIssues > 0 && (
          <Card variant="flat" style={styles.callout}>
            <Text style={styles.calloutValue}>{openRate}%</Text>
            <Text style={styles.calloutLabel}>of issues are currently open</Text>
          </Card>
        )}

        {/* By Status */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>By Status</Text>
          {(Object.keys(STATUS_LABELS) as IssueStatus[]).map(s => (
            <BarRow
              key={s}
              label={STATUS_LABELS[s]}
              count={stats.byStatus[s]}
              total={stats.totalIssues}
              color={statusColor(s)}
            />
          ))}
        </Card>

        {/* By Priority */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>By Priority</Text>
          {(Object.keys(PRIORITY_LABELS) as IssuePriority[]).map(p => (
            <BarRow
              key={p}
              label={PRIORITY_LABELS[p]}
              count={stats.byPriority[p]}
              total={stats.totalIssues}
              color={priorityColor(p)}
            />
          ))}
        </Card>

        {/* By Category */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>By Category</Text>
          {(Object.keys(CATEGORY_LABELS) as IssueCategory[]).map(c => (
            <BarRow
              key={c}
              label={CATEGORY_LABELS[c]}
              count={stats.byCategory[c]}
              total={stats.totalIssues}
              color={categoryColor(c)}
            />
          ))}
        </Card>

        {stats.totalIssues === 0 && (
          <Text style={styles.emptyText}>No issues reported yet. Reports will appear here once your team starts logging issues.</Text>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  headerSub: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingTop: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  scroll: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  callout: {
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  calloutValue: {
    fontSize: Typography.xxxl,
    fontWeight: Typography.bold,
    color: Colors.primary,
  },
  calloutLabel: {
    fontSize: Typography.sm,
    color: Colors.primary,
    marginTop: Spacing.xs,
  },
  card: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  cardTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  barLabel: {
    width: 110,
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: Colors.background,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    minWidth: 4,
  },
  barCount: {
    width: 28,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
    textAlign: 'right',
  },
  emptyText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    paddingVertical: Spacing.lg,
  },
});
