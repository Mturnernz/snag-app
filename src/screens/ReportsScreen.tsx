import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase, getOrgStats, OrgStats } from '../lib/supabase';
import {
  STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS,
  SnagStatus, SnagKind, SnagSeverity,
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

function statusColor(s: SnagStatus): string {
  const map: Record<SnagStatus, string> = {
    flagged: Colors.status.flagged,
    in_progress: Colors.status.inProgress,
    resolved: Colors.status.resolved,
    rca_pending: Colors.status.rcaPending,
  };
  return map[s];
}

function kindColor(k: SnagKind): string {
  const map: Record<SnagKind, string> = {
    fixit: Colors.category.niggle,
    improvement: Colors.category.other,
    hazard: Colors.category.brokenEquipment,
    incident: Colors.category.healthAndSafety,
  };
  return map[k];
}

function severityColor(s: SnagSeverity): string {
  const map: Record<SnagSeverity, string> = {
    minor: Colors.priority.low,
    moderate: Colors.priority.medium,
    injury: Colors.category.brokenEquipment,
    critical: Colors.priority.high,
  };
  return map[s];
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
      .select('org_id, organisation:organisations(name)')
      .eq('id', user.id)
      .single();

    if (data?.org_id) {
      setOrgName((data.organisation as any)?.name ?? '');
      setStats(await getOrgStats(data.org_id));
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

  const openRate = stats.totalSnags > 0
    ? Math.round((stats.byStatus.flagged / stats.totalSnags) * 100)
    : 0;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Reports" />
      {orgName ? <Text style={styles.headerSub}>{orgName}</Text> : null}

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}>

        {/* Summary row */}
        <View style={styles.summaryRow}>
          <StatBox label="Total Snags" value={stats.totalSnags} />
          <StatBox label="Members" value={stats.totalMembers} />
          <StatBox label="Flagged" value={stats.byStatus.flagged} accent={Colors.status.flagged} />
          <StatBox label="Critical" value={stats.bySeverity.critical} accent={Colors.priority.high} />
        </View>

        {/* Open rate callout */}
        {stats.totalSnags > 0 && (
          <Card variant="flat" style={styles.callout}>
            <Text style={styles.calloutValue}>{openRate}%</Text>
            <Text style={styles.calloutLabel}>of snags are still flagged</Text>
          </Card>
        )}

        {/* By Status */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>By Status</Text>
          {(Object.keys(STATUS_LABELS) as SnagStatus[]).map(s => (
            <BarRow
              key={s}
              label={STATUS_LABELS[s]}
              count={stats.byStatus[s]}
              total={stats.totalSnags}
              color={statusColor(s)}
            />
          ))}
        </Card>

        {/* By Type */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>By Type</Text>
          {(Object.keys(KIND_LABELS) as SnagKind[]).map(k => (
            <BarRow
              key={k}
              label={KIND_LABELS[k]}
              count={stats.byKind[k]}
              total={stats.totalSnags}
              color={kindColor(k)}
            />
          ))}
        </Card>

        {/* By Severity */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>By Severity</Text>
          {(Object.keys(SEVERITY_LABELS) as SnagSeverity[]).map(s => (
            <BarRow
              key={s}
              label={SEVERITY_LABELS[s]}
              count={stats.bySeverity[s]}
              total={stats.totalSnags}
              color={severityColor(s)}
            />
          ))}
        </Card>

        {stats.totalSnags === 0 && (
          <Text style={styles.emptyText}>No snags reported yet. Reports will appear here once your team starts logging them.</Text>
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
