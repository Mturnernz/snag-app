import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, SectionList, Pressable, Modal, RefreshControl, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import AddProjectSheet from '../components/AddProjectSheet';
import ExportFooter from '../components/ExportFooter';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  createLocation, createProject, formatMoney, getProjects, getProjectsQuoted, inclGst, projectSubtitle,
} from '../lib/supabase';
import type { ProjectInput } from '@snag/supabase-queries';
import {
  budgetRemaining, describeRemaining, exportDateStamp, groupProjectsByStatus, projectExportTable,
  type RemainingTone,
} from '@snag/supabase-queries';
import { writeExport, type ExportFormat } from '../lib/exportFile';
import { showAlert } from '../lib/alert';
import {
  Project, PROJECT_STATUS_LABELS, RootStackParamList,
} from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The Projects tab — what we're *changing* about the place.
 *
 * The third noun. The list holds what is wrong with the house, the House tab
 * holds what is in it, and neither could hold a renovation: a body of work with
 * a budget, a span of rooms, a folder of quotes, and an answer to "what did the
 * bathroom actually cost".
 *
 * **Grouped by state, never by date.** Underway, then Planned, then Complete — the
 * order somebody actually cares about them in, and the reason there is no
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
  const navigation = useNavigation<Nav>();
  const insets = useEdgeInsets();
  const {
    household, properties, activeProperty, setActiveProperty, locations, reloadLocations,
  } = useHousehold();
  const { showToast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  // Null until the quoted read answers, and again if it fails: "No quotes" is
  // a claim, and a read that has not come back cannot make it.
  const [quoted, setQuoted] = useState<Map<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!activeProperty) return;
    try {
      const next = await getProjects(activeProperty.id);
      setProjects(next);
      // Never fatal: a card without its quoted line is still a card.
      getProjectsQuoted(next.map((p) => p.id)).then(setQuoted, () => setQuoted(null));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't load the projects");
    } finally {
      setLoading(false);
    }
  }, [activeProperty?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const sections = useMemo(
    () =>
      groupProjectsByStatus(projects).map((group) => ({
        title: PROJECT_STATUS_LABELS[group.status],
        status: group.status,
        data: group.projects,
      })),
    [projects]
  );

  /**
   * A room added here is a room everywhere.
   *
   * Same RPC, same property and the same `reloadLocations()` the House tab's
   * *Add a room* line calls — rooms are a property's vocabulary, not one
   * screen's, and two screens keeping separate ideas of what rooms exist is how
   * the tabs stop describing the same house.
   */
  async function addRoom(name: string): Promise<boolean> {
    if (!activeProperty) return false;
    try {
      await createLocation(activeProperty.id, name);
      await reloadLocations();
      showToast(`${name} added`);
      return true;
    } catch (err: unknown) {
      // The RPC refuses a blank name and a duplicate in words, so this is worth
      // showing rather than swallowing.
      showAlert("Couldn't add that room", err instanceof Error ? err.message : 'Please try again.');
      return false;
    }
  }

  async function start(input: ProjectInput) {
    try {
      const project = await createProject(input);
      setSheetOpen(false);
      showToast('Started');
      await load();
      navigation.navigate('ProjectDetail', { projectId: project.id });
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

  const placeName = properties.length > 1 ? activeProperty?.name ?? household.name : household.name;
  const counts = [
    projects.filter((p) => p.status === 'underway').length,
    projects.filter((p) => p.status === 'planned').length,
    projects.filter((p) => p.status === 'done').length,
  ];
  const summary = projects.length
    ? [
        counts[0] ? `${counts[0]} underway` : null,
        counts[1] ? `${counts[1]} planned` : null,
        counts[2] ? `${counts[2]} complete` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Nothing recorded yet';

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
        <Text style={styles.sub}>
          {properties.length > 1 ? `${placeName} · ${summary}` : summary}
        </Text>
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
          renderItem={({ item, section }) => (
            <ProjectCard
              project={item}
              quoted={quoted ? quoted.get(item.id) ?? null : undefined}
              dim={section.status === 'done'}
              onPress={() => navigation.navigate('ProjectDetail', { projectId: item.id })}
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
        locations={locations}
        onAddRoom={addRoom}
        onCancel={() => setSheetOpen(false)}
        onCreate={start}
      />

      <Modal visible={placesOpen} transparent animationType="slide" onRequestClose={() => setPlacesOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPlacesOpen(false)} accessibilityLabel="Close" />
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
              <Text
                style={[
                  styles.placeLabel,
                  property.id === activeProperty?.id && styles.placeLabelOn,
                ]}
              >
                {property.name}
              </Text>
              {property.id === activeProperty?.id ? (
                <Icon name="checkmark" size="md" color={Colors.primary} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </Modal>
    </View>
  );
}

/**
 * One project on the tab: what was budgeted, what the suppliers have quoted,
 * and what has actually been paid.
 *
 * **Three figures, stacked.** Label left, figure right, one line each: a
 * project's totals are the longest answers in the app, and three across a
 * phone is where `$182,103.71` gets cut in half. Each is the page's own figure
 * or the view's — Budgeted is the typed budget grossed to incl GST, Quoted is
 * the supplier rows' sum (`getProjectsQuoted`, never fatal), Paid is
 * `paid_total` — so nothing here is a second way of adding something up. A
 * figure nobody has is said in words, never as `$0`.
 *
 * **Budget remaining appears once money has gone out**, and it is budget less
 * paid: the cash view, coloured by how much of the budget is left (fern above
 * 15%, brass down to 5%, clay at 5% or less and over), with the percentage
 * beside it so colour is never the only way to read it. It is deliberately not
 * the page's *Left in budget*, which takes off everything expected; Quoted sits
 * two lines above it for exactly that reason.
 *
 * Under it: how many things are left to decide and what is owed — counts and
 * sums, nothing to believe. A complete project carries the same figures,
 * dimmed, because "what did it cost" is the question it is opened to answer.
 */
const TONE: Record<RemainingTone, string> = {
  good: Colors.primary,
  warn: Colors.status.doing,
  danger: Colors.danger,
};

function ProjectCard({
  project,
  quoted,
  dim,
  onPress,
}: {
  project: Project;
  /** Undefined while the quoted read is out or has failed; null when nobody has quoted. */
  quoted: number | null | undefined;
  dim: boolean;
  onPress: () => void;
}) {
  const budget = inclGst(project.budget, project.budgetInclGst);
  const paid = project.paidTotal;
  const left = budgetRemaining(project.budget, project.budgetInclGst, paid);
  const remaining = left ? describeRemaining(left, (n) => formatMoney(n) ?? '') : null;
  const toDecide = Math.max(project.itemCount - project.pricedCount, 0);
  const facts = [
    toDecide > 0 ? `${toDecide} to decide` : null,
    project.dueToPay > 0.005 ? `${formatMoney(project.dueToPay)} to pay` : null,
    project.openSnagCount > 0 ? `${project.openSnagCount} to sort out` : null,
  ].filter(Boolean);

  const figures: { label: string; value: string | null; blank: string }[] = [
    { label: 'Budgeted', value: budget !== null && budget > 0 ? formatMoney(budget) : null, blank: 'Not set' },
    {
      label: 'Quoted',
      value: quoted !== undefined && quoted !== null ? formatMoney(quoted) : null,
      blank: quoted === undefined ? '—' : 'No quotes',
    },
    { label: 'Paid', value: paid !== null && paid > 0.005 ? formatMoney(paid) : null, blank: 'Nothing yet' },
  ];

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, dim && styles.cardDone]}
      accessibilityRole="button"
      accessibilityLabel={project.name}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardTitles}>
          <Text style={styles.cardName}>{project.name}</Text>
          {dim ? <Text style={styles.cardSub} numberOfLines={1}>{projectSubtitle(project)}</Text> : null}
        </View>
        <Icon name="chevron-forward" size={16} color={Colors.chevron} />
      </View>
      <View style={styles.figures}>
        {figures.map((f) => (
          <View key={f.label} style={styles.figureRow}>
            <Text style={styles.figureLabel}>{f.label}</Text>
            <Text style={[styles.figureValue, f.value === null && styles.figureBlank]} numberOfLines={1}>
              {f.value ?? f.blank}
            </Text>
          </View>
        ))}
      </View>
      {left && remaining ? (
        <View style={styles.remaining}>
          <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View
              style={[
                styles.barFill,
                { width: `${Math.min(Math.max((paid ?? 0) / left.budget, 0), 1) * 100}%`, backgroundColor: TONE[left.tone] },
              ]}
            />
          </View>
          <View style={styles.figureRow}>
            <Text style={styles.remainingLabel}>{remaining.label}</Text>
            <Text style={[styles.remainingValue, { color: TONE[left.tone] }]} numberOfLines={1}>
              {remaining.value}
            </Text>
          </View>
        </View>
      ) : null}
      {facts.length > 0 ? (
        <Text style={[styles.facts, project.overdueTotal > 0.005 && styles.factsOverdue]}>
          {facts.join('   ·   ')}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg + 4, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  place: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  title: {
    fontSize: Typography.largeTitle, lineHeight: 41, fontWeight: Typography.bold,
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
  cardTitles: { flex: 1, minWidth: 0, gap: 2 },
  cardName: { fontSize: Typography.body, lineHeight: 22, fontWeight: Typography.semibold, color: Colors.textPrimary },
  cardSub: { fontSize: Typography.subhead, color: Colors.textMuted },
  figures: { gap: Spacing.xs + 2 },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.md },
  figureLabel: { fontSize: Typography.subhead, color: Colors.textMuted, flexShrink: 0 },
  figureValue: {
    fontSize: Typography.body, color: Colors.textPrimary, fontVariant: ['tabular-nums'],
    flexShrink: 1, minWidth: 0, textAlign: 'right',
  },
  figureBlank: { fontSize: Typography.subhead, color: Colors.textMuted },
  remaining: { gap: Spacing.sm, marginTop: Spacing.xs },
  remainingLabel: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.textPrimary, flexShrink: 0 },
  remainingValue: {
    fontSize: Typography.body, fontWeight: Typography.semibold, fontVariant: ['tabular-nums'],
    flexShrink: 1, minWidth: 0, textAlign: 'right',
  },
  bar: { height: 6, borderRadius: 3, backgroundColor: Colors.track, overflow: 'hidden' },
  barFill: { height: 6 },
  facts: { fontSize: Typography.subhead, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  factsOverdue: { color: Colors.danger },

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


  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  sheetTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
  },
  placeLabel: { fontSize: Typography.base, color: Colors.textSecondary },
  placeLabelOn: { color: Colors.primary, fontWeight: Typography.semibold },
});
