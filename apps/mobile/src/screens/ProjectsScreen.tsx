import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, SectionList, Pressable, Modal, RefreshControl, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import AddProjectSheet from '../components/AddProjectSheet';
import ExportFooter from '../components/ExportFooter';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  createLocation, createProject, describeTotals, formatMoney, getProjects, outstanding,
  projectSubtitle,
} from '../lib/supabase';
import type { ProjectInput } from '@snag/supabase-queries';
import { exportDateStamp, groupProjectsByStatus, projectExportTable } from '@snag/supabase-queries';
import { writeExport, type ExportFormat } from '../lib/exportFile';
import { showAlert } from '../lib/alert';
import {
  Project, ProjectStatus, PROJECT_STATUS_LABELS, RootStackParamList,
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
 * **Grouped by state, never by date.** Underway, then Planned, then Done — the
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
  const insets = useSafeAreaInsets();
  const {
    household, properties, activeProperty, setActiveProperty, locations, reloadLocations,
  } = useHousehold();
  const { showToast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!activeProperty) return;
    try {
      setProjects(await getProjects(activeProperty.id));
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
        counts[2] ? `${counts[2]} done` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Nothing recorded yet';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => properties.length > 1 && setPlacesOpen(true)}
          disabled={properties.length < 2}
          style={styles.place}
          accessibilityRole={properties.length > 1 ? 'button' : undefined}
        >
          <Text style={styles.title}>Projects</Text>
          {properties.length > 1 ? (
            <Icon name="chevron-down" size="sm" color={Colors.textMuted} />
          ) : null}
        </Pressable>
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
            <View style={styles.groupRow}>
              <Text style={styles.group}>{section.title}</Text>
              <View style={styles.groupRule} />
            </View>
          )}
          renderItem={({ item, section }) => (
            <ProjectCard
              project={item}
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

      {sections.length > 0 ? (
        <Pressable
          onPress={() => setSheetOpen(true)}
          style={[styles.fab, { bottom: insets.bottom + Spacing.lg }]}
          accessibilityRole="button"
          accessibilityLabel="Start a project"
        >
          <Icon name="add" size="lg" color={Colors.white} />
        </Pressable>
      ) : null}

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
 * One project on the tab.
 *
 * The money line is the card's point, and it obeys the rule the whole feature
 * rests on: **a total never appears without its denominator.** `describeTotals`
 * writes the second line, and there is no code path here that renders the first
 * without it.
 */
function ProjectCard({
  project,
  dim,
  onPress,
}: {
  project: Project;
  dim: boolean;
  onPress: () => void;
}) {
  const committed = formatMoney(project.committedTotal);
  const paid = formatMoney(project.paidTotal);
  const owing = formatMoney(outstanding(project));
  const denominator = describeTotals(project);

  // Three sentences for three states, because "what has this cost" and "what
  // is still to pay" are different questions and a project answers whichever it
  // can. Nothing is invented when it can answer neither.
  //
  // Outstanding leads the card rather than Paid: on a list of renovations the
  // question is what is still to find, and a card that said "$88,600 paid" of a
  // $192,354 job would read as nearly done.
  let money: string | null = null;
  if (committed && owing && owing !== committed) {
    money = `${committed} committed · ${owing} still to pay`;
  } else if (committed) {
    money = `${committed} committed`;
  } else if (paid) {
    money = `${paid} paid`;
  }

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, dim && styles.cardDim]}
      accessibilityRole="button"
      accessibilityLabel={project.name}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardTitles}>
          <Text style={styles.cardName}>{project.name}</Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {projectSubtitle(project)}
          </Text>
        </View>
        <View style={[styles.badge, badgeStyle(project.status)]}>
          <Text style={[styles.badgeLabel, badgeLabelStyle(project.status)]}>
            {PROJECT_STATUS_LABELS[project.status]}
          </Text>
        </View>
      </View>

      {money ? <Text style={styles.money}>{money}</Text> : null}
      {denominator ? <Text style={styles.denominator}>{denominator}</Text> : null}

      {project.openSnagCount > 0 || project.fileCount > 0 ? (
        <View style={styles.cardFoot}>
          {project.openSnagCount > 0 ? (
            <View style={styles.pill}>
              <Text style={styles.pillLabel}>
                {project.openSnagCount === 1 ? '1 to sort out' : `${project.openSnagCount} to sort out`}
              </Text>
            </View>
          ) : null}
          {project.fileCount > 0 ? (
            <View style={styles.pill}>
              <Text style={styles.pillLabel}>
                {project.fileCount === 1 ? '1 file' : `${project.fileCount} files`}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// Status carries the same three hues the rest of the app spends on state:
// slate is a state rather than a warning, brass is doing, done is neutral —
// fern is the brand and fern is not "done".
function badgeStyle(status: ProjectStatus) {
  if (status === 'underway') return { backgroundColor: Colors.status.doingBg };
  if (status === 'done') return { backgroundColor: Colors.status.doneBg };
  return { backgroundColor: Colors.status.openBg };
}
function badgeLabelStyle(status: ProjectStatus) {
  if (status === 'underway') return { color: Colors.status.doingFg };
  if (status === 'done') return { color: Colors.status.doneFg };
  return { color: Colors.status.openFg };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.md },
  place: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  title: { fontSize: Typography.xxl, fontWeight: Typography.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: 2 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl * 2 },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  group: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  groupRule: { flex: 1, height: 1, backgroundColor: Colors.border },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  // The same translucency a parked repeat takes on the list, and the same fact
  // behind it: there is nothing to do about this one.
  cardDim: { opacity: 0.62 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  cardTitles: { flex: 1, minWidth: 0 },
  cardName: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  cardSub: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: 1 },
  badge: { borderRadius: Radius.chip, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  badgeLabel: { fontSize: Typography.xs, fontWeight: Typography.semibold },
  money: {
    fontFamily: Fonts.mono,
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  // Never optional, and never in a lighter weight than it can be read at: this
  // is the line that stops the figure above it being believed on its own.
  denominator: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },
  cardFoot: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.sm },
  pill: {
    backgroundColor: Colors.effort.bg,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  pillLabel: { fontSize: Typography.xs, color: Colors.effort.fg, fontWeight: Typography.medium },

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

  fab: {
    position: 'absolute',
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.md,
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
