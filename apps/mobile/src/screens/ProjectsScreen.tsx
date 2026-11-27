import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  SectionList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import AddProjectSheet from '../components/AddProjectSheet';
import ExportFooter from '../components/ExportFooter';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import HomePickerSheet from '../components/HomePickerSheet';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useDockClearance } from '../navigation/Dock';
import { useToast } from '../hooks/useToast';
import {
  createProject, formatMoney, getProjectPrices, getProjects, inclGst,
} from '../lib/supabase';
import type { ProjectInput } from '@snag/supabase-queries';
import {
  describeDifference, describeQuoted, exportDateStamp, groupProjectsByStatus, placeTitle,
  projectExportTable, projectLedger, type ProjectLedger,
} from '@snag/supabase-queries';
import { writeExport, type ExportFormat } from '../lib/exportFile';
import { showAlert } from '../lib/alert';
import {
  Project, ProjectStatus, RootStackParamList,
} from '../types';

const SECTION_TITLES: Record<ProjectStatus, string> = {
  underway: 'In progress',
  done: 'Completed',
  planned: 'Planned',
};

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The Projects tab — what we're *changing* about the place.
 *
 * The third noun. The list holds what is wrong with the house, the House tab
 * holds what is in it, and neither could hold a renovation: a body of work with
 * a budget, a span of rooms, a folder of quotes, and an answer to "what did the
 * bathroom actually cost".
 *
 * **Grouped by state, never by date.** In progress, then Completed, then
 * Planned — the order of Alyssa's wireframe (November 2026), and the reason there is no
 * filter rail on this screen. A household has three or four projects, not
 * forty; a filter over four rows is a control charging vertical rent to answer
 * a question the rows already answer.
 *
 * **Done dims and sinks, and does not leave.** The list tab's rule is that
 * finishing something makes the list shorter, because the reward for doing a
 * household job is the item going away. A renovation is the opposite: the
 * finished one is the record you open in four years, in front of a valuer or an
 * insurer. So it takes the same `opacity: 0.62` a parked repeat takes — there is
 * nothing to do about it — and stays exactly where it can be found.
 *
 * **Day one is genuinely empty, and that is allowed here.** The House tab
 * arrives furnished with ghosts because a catalogue can guess that a kitchen has
 * a rangehood. Nothing can guess your renovations, and a suggested project would
 * be a fabrication rather than a prompt — the ghost rule's own argument, one
 * noun further on. The empty state names the second use instead: the renovation
 * you have already done.
 *
 * **There is no compose bar on this tab, and there must never be one.** A
 * project is started deliberately, at a desk, like a thing. The compose bar is
 * capture, capture is snags, and the ten-second gesture would produce a project
 * with a name and nothing else at the one moment nobody is standing at a
 * workbench.
 */
export default function ProjectsScreen() {
  const clearance = useDockClearance();
  const navigation = useNavigation<Nav>();
  const insets = useEdgeInsets();
  const {
    household, properties, activeProperty,
  } = useHousehold();
  const { showToast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  // One ledger per project, from one read of every price on them. Absent
  // while that read is out, or when it failed: a card then says — rather than
  // a figure it cannot back.
  const [ledgers, setLedgers] = useState<Map<string, ProjectLedger> | null>(null);
  const generation = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!activeProperty) return;
    const run = ++generation.current;
    try {
      const next = await getProjects(activeProperty.id);
      if (run !== generation.current) return;
      setProjects(next);
      try {
        const prices = await getProjectPrices(next.map((p) => p.id));
        if (run !== generation.current) return;
        setLedgers(new Map(next.map((p) => [
          p.id,
          projectLedger(prices.get(p.id) ?? [], inclGst(p.budget, p.budgetInclGst)),
        ])));
      } catch {
        if (run === generation.current) setLedgers(null);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't load the projects");
    } finally {
      setLoading(false);
    }
  }, [activeProperty?.id]);

  function openProject(projectId: string) {
    navigation.navigate('ProjectDetail', { projectId });
  }

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        generation.current += 1;
      };
    }, [load])
  );

  const sections = useMemo(
    () =>
      // The wireframe's order: what is happening, what is done, what is next.
      (['underway', 'done', 'planned'] as const)
        .map((status) => ({
          title: SECTION_TITLES[status],
          status,
          data: groupProjectsByStatus(projects).find((g) => g.status === status)?.projects ?? [],
        }))
        .filter((section) => section.data.length > 0),
    [projects]
  );

  async function start(input: ProjectInput) {
    try {
      const project = await createProject(input);
      setSheetOpen(false);
      showToast('Started');
      await load();
      openProject(project.id);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't start that");
    }
  }

  /**
   * What has been done to this house, in one file.
   *
   * There is no lens on this tab, so both scopes are the same set of rows —
   * they are offered anyway because the sheet is one dialog everywhere and a
   * missing chip would read as a bug rather than as a simplification.
   *
   * **No brief.** `canBrief` is off: a brief asks what is wrong with something
   * and what it would take to fix, and nothing is wrong with a renovation that
   * has merely been recorded. The same reason the house record has no brief.
   */
  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      const table = projectExportTable(projects, {
        household: household.name,
        place: activeProperty?.name ?? household.name,
        scope: scope === 'all' ? 'Everything' : "What's on screen",
        stamp: exportDateStamp(),
      });
      const { fileName, path } = await writeExport(table, format, []);
      setShowExport(false);
      showToast(path ? `Saved to ${fileName}` : `${fileName} downloaded`);
    } catch (err: unknown) {
      showAlert("Couldn't make that file", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  // The headings below already count the jobs by state, so the line under the
  // title names only the home, and only when there is more than one.
  const placeName = placeTitle(activeProperty, properties);
  // What has actually gone out, across every project at this place.
  const totalSpent = ledgers ? [...ledgers.values()].reduce((n, l) => n + l.paid, 0) : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => properties.length > 1 && setPlacesOpen(true)}
            disabled={properties.length < 2}
            style={styles.place}
            accessibilityRole={properties.length > 1 ? 'button' : undefined}
          >
            <Text style={styles.title} accessibilityRole="header">Projects</Text>
            {properties.length > 1 ? (
              <Icon name="chevron-down" size="sm" color={Colors.textMuted} />
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => setSheetOpen(true)}
            style={styles.newTap}
            accessibilityRole="button"
            accessibilityLabel="Start a project"
          >
            <View style={styles.newDisc}>
              <Icon name="add" size={20} color={Colors.primary} />
            </View>
          </Pressable>
        </View>
        {properties.length > 1 ? <Text style={styles.sub}>{placeName}</Text> : null}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(clearance, Spacing.xxxl) + Spacing.lg },
            sections.length === 0 && styles.listEmpty,
          ]}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={Colors.primary}
            />
          }
          renderSectionHeader={({ section }) => (
            <Text style={styles.group} accessibilityRole="header">{section.title}</Text>
          )}
          ListHeaderComponent={
            projects.length > 0 ? (
              <View style={styles.spend}>
                <Text style={styles.spendLabel}>Total spent on the property</Text>
                <Text style={styles.spendValue} numberOfLines={1} adjustsFontSizeToFit>
                  {ledgers ? formatMoney(totalSpent) ?? '$0' : '—'}
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <ProjectCard
              project={item}
              ledger={ledgers?.get(item.id)}
              onPress={() => openProject(item.id)}
            />
          )}
          ListFooterComponent={
            projects.length > 0 ? (
              <ExportFooter label="Export what’s been done" onPress={() => setShowExport(true)} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="construct-outline" size="xxl" color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Nothing on the go</Text>
              <Text style={styles.emptyBody}>
                A project is work you’re doing <Text style={styles.italic}>to</Text> the house — a
                renovation, a rebuild, a new heat pump. Planned or already finished, both belong
                here.
              </Text>
              <Pressable
                onPress={() => setSheetOpen(true)}
                style={styles.emptyCta}
                accessibilityRole="button"
                accessibilityLabel="Start a project"
              >
                <Text style={styles.emptyCtaLabel}>Start a project</Text>
              </Pressable>
              <Text style={styles.emptyFoot}>
                Recording one you’ve already finished is worth as much as planning one — it’s where
                the receipts and the guarantee live.
              </Text>
            </View>
          }
        />
      )}


      <ExportSheet
        visible={showExport}
        what="the projects"
        counts={{ view: projects.length, all: projects.length }}
        busy={exporting}
        onExport={handleExport}
        onCancel={() => setShowExport(false)}
      />

      <AddProjectSheet
        visible={sheetOpen}
        propertyId={activeProperty?.id ?? ''}
        onCancel={() => setSheetOpen(false)}
        onCreate={start}
      />

      <HomePickerSheet visible={placesOpen} onClose={() => setPlacesOpen(false)} />
    </View>
  );
}

/**
 * One project on the tab, in the shape the wireframe gave each state.
 *
 * - **In progress**: Budget, Paid, Outstanding (only when something is owed)
 *   and Difference — budget less the expected total, in words, clay when over.
 *   The expected total itself is on the project's page.
 * - **Completed**: what it cost — what was paid — and nothing else.
 * - **Planned**: Budget and what has been quoted ("3 quotes · $850–$1,400").
 *
 * A figure nobody has is said in words, never `$0`; a figure never shrinks,
 * the label beside it gives way.
 */
function ProjectCard({
  project,
  ledger,
  onPress,
}: {
  project: Project;
  /** Undefined while the prices are being read, or when they could not be. */
  ledger: ProjectLedger | undefined;
  onPress: () => void;
}) {
  const money = (n: number) => formatMoney(n) ?? '';
  const budget = inclGst(project.budget, project.budgetInclGst);
  const dash = '—';
  const rows: { label: string; value: string | null; blank: string; tone?: 'over' | 'under' }[] = [];

  if (project.status === 'done') {
    rows.push({ label: 'Cost', value: ledger && ledger.paid > 0.005 ? money(ledger.paid) : null, blank: ledger ? 'Nothing recorded' : dash });
  } else if (project.status === 'planned') {
    rows.push({ label: 'Budget', value: budget !== null && budget > 0 ? money(budget) : null, blank: 'Not set' });
    rows.push({
      label: 'Quoted',
      value: ledger ? describeQuoted(ledger.quotedRange, money) : null,
      blank: ledger ? 'No quotes yet' : dash,
    });
  } else {
    rows.push({ label: 'Budget', value: budget !== null && budget > 0 ? money(budget) : null, blank: 'Not set' });
    rows.push({ label: 'Paid', value: ledger && ledger.paid > 0.005 ? money(ledger.paid) : null, blank: ledger ? 'Nothing yet' : dash });
    if (ledger && ledger.outstanding > 0.005) rows.push({ label: 'Outstanding', value: money(ledger.outstanding), blank: '' });
    if (ledger && ledger.difference !== null) {
      const d = describeDifference(ledger.difference, money);
      rows.push({ label: 'Difference', value: d.text, blank: '', tone: d.over ? 'over' : 'under' });
    }
  }

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, project.status === 'done' && styles.cardDone]}
      accessibilityRole="button"
      accessibilityLabel={project.name}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardName}>{project.name}</Text>
        <Icon name="chevron-forward" size={16} color={Colors.chevron} />
      </View>
      <View style={styles.figures}>
        {rows.map((f) => (
          <View key={f.label} style={styles.figureRow}>
            <Text style={styles.figureLabel}>{f.label}</Text>
            <Text
              style={[
                styles.figureValue,
                f.value === null && styles.figureBlank,
                f.tone === 'over' && styles.over,
              ]}
              numberOfLines={1}
            >
              {f.value ?? f.blank}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg + 4, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  place: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  title: {
    fontSize: Typography.largeTitle, lineHeight: 41, minHeight: 41, fontWeight: Typography.bold,
    color: Colors.textPrimary, letterSpacing: -0.4,
  },
  sub: { fontSize: Typography.subhead, color: Colors.textMuted, marginTop: 2 },
  newTap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'flex-end', justifyContent: 'center' },
  newDisc: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl * 2 },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  group: {
    fontSize: Typography.title3, lineHeight: 25, fontWeight: Typography.semibold,
    color: Colors.textPrimary, letterSpacing: -0.3,
    marginTop: Spacing.xl, marginBottom: Spacing.sm + 2, paddingHorizontal: 4,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.lg + 2,
    paddingTop: Spacing.lg + 2,
    paddingBottom: Spacing.lg,
    marginBottom: Spacing.sm + 2,
    gap: Spacing.md,
  },
  // The same translucency a parked repeat takes on the list, for the same
  // reason: there is nothing to do about this one, and it stays findable.
  cardDone: { opacity: 0.62 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  cardName: { flex: 1, minWidth: 0, fontSize: Typography.body, lineHeight: 22, fontWeight: Typography.semibold, color: Colors.textPrimary },
  figures: { gap: Spacing.xs + 2 },
  over: { color: Colors.danger, fontWeight: Typography.semibold },
  spend: { paddingHorizontal: 4, paddingTop: Spacing.md, gap: 2 },
  spendLabel: { fontSize: Typography.subhead, color: Colors.textMuted },
  spendValue: {
    fontSize: 40, lineHeight: 46, fontWeight: Typography.bold, color: Colors.textPrimary,
    letterSpacing: -1, fontVariant: ['tabular-nums'],
  },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.md },
  figureLabel: { fontSize: Typography.subhead, color: Colors.textMuted, flexShrink: 1, minWidth: 0 },
  figureValue: {
    fontSize: Typography.body, color: Colors.textPrimary, fontVariant: ['tabular-nums'],
    flexShrink: 0, textAlign: 'right',
  },
  figureBlank: { fontSize: Typography.subhead, color: Colors.textMuted },

  empty: { alignItems: 'center', paddingHorizontal: Spacing.xl },
  emptyTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  emptyBody: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  italic: { fontStyle: 'italic' },
  emptyCta: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  emptyCtaLabel: { color: Colors.white, fontSize: Typography.base, fontWeight: Typography.semibold },
  emptyFoot: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing.md,
  },
});
