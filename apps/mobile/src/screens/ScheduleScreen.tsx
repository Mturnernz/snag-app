import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, RefreshControl, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  dayKey, describeCycle, marksOn, monthGrid, scheduleMarks, snagHeadline,
  SCHEDULE_KIND_LABELS, type ScheduleKind, type ScheduleMark,
} from '@snag/supabase-queries';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { getAllProjects, getSnags } from '../lib/supabase';
import { Project, RootStackParamList, Snag } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * When things happened, and when they come round.
 *
 * The list answers "what needs doing"; it is deliberately bad at "when was the
 * heat pump filter last changed" and "is anything landing the weekend we're
 * away", because both are questions about dates and the list is organised by
 * room. This is the same data arranged the other way.
 *
 * **It reads and never writes, and that is the load-bearing rule.** There is
 * one scheduling mechanism in this app — `due_at` plus `repeat_days`, set in
 * triage and rolled forward by `home.set_snag_status` when a repeating job is
 * marked done — and the moment there are two ways to schedule something,
 * neither is trustworthy. So no cell here is draggable, nothing can be moved to
 * another day, and there is no + . Every row is a door back to the snag, where
 * the date is set the one way it is ever set.
 *
 * It changes nothing else about the product either: there are still no
 * notifications and there deliberately never will be. A calendar that could
 * remind you would be the first thing in this app that talks to you unasked.
 *
 * **Every place at once, and no picker.** The other two tabs are about a place
 * you are standing in, so they ask which one. This tab is about a date, and a
 * date does not belong to a house: "are we free that weekend" is the wrong
 * question to answer for the bach only because the bach is what the House tab
 * happened to be showing. So it reads every property the user is linked to —
 * `property_members` already decides what that is — and names the place on each
 * row when there is more than one.
 *
 * Three things about the month:
 *
 * - **Four kinds of mark, and one of them isn't real.** Added, Done and Due
 *   each come off a column. *Comes round* is arithmetic — `due_at` walked
 *   forward by `repeat_days` — and no row exists for any of them. It is drawn
 *   hollow for the same reason a suggestion on the House tab is drawn dashed:
 *   showing something unconfirmed as though it were confirmed is worse than not
 *   showing it. **If the hollow/solid distinction ever blurs, the projection
 *   goes rather than the distinction.**
 * - **A day is a local day.** `dayKey` is the one place an instant becomes a
 *   calendar cell, so the grid and the marks cannot disagree about where a 9pm
 *   due date belongs — which in NZDT is the difference between Saturday and
 *   Sunday.
 * - **The grid is always six weeks.** A month that reflows as you page through
 *   it makes the arrows feel like they moved something other than the month.
 */

/**
 * The colour each mark carries, straight out of the badge vocabulary.
 *
 * Nothing new is spent here. A calendar is the easiest screen in any app to
 * turn into a colour chart, and this palette has four hues with one job each.
 */
const KIND_COLOURS: Record<ScheduleKind, string> = {
  // Slate: a state, not a warning. Something arriving on the list is neither.
  filed: Colors.status.open,
  // Neutral, because fern is the brand and fern is not "done".
  done: Colors.status.done,
  // Brass, the same as DueBadge's "due within the week". A date in the past
  // takes clay instead — see `markColour`.
  due: Colors.due.soonFg,
  next: Colors.due.soonFg,
  // Neutral, and distinguished by **shape** rather than by a fifth hue: a
  // project mark is a square where everything else is a circle. This palette
  // has four hues with one job each and a renovation is not a snag state, so
  // the distinction it needs is the one hollow-vs-solid already makes for a
  // projection — form, not colour.
  project: Colors.textMuted,
};

/**
 * What one mark is drawn in.
 *
 * The only thing that moves off `KIND_COLOURS` is an overdue date, which takes
 * clay — the one thing on a household list that has earned red, and a fact
 * about a date rather than a judgement about importance. A *projected* repeat
 * is never overdue however far back it sits: nothing is due then, because
 * nothing has rolled the date forward yet.
 */
function markColour(mark: ScheduleMark, todayKey: string): string {
  const overdue =
    mark.kind === 'due' && mark.day < todayKey && mark.snag?.status !== 'done';
  return overdue ? Colors.due.overdueFg : KIND_COLOURS[mark.kind];
}

/**
 * Hollow for a projection, filled for something that happened or is written.
 *
 * `onFill` is the selected day, where the cell is already solid fern: the
 * dots go white there rather than keeping a hue nobody can see against it.
 * Not a fifth colour — the same two shapes, inverted.
 */
function dotStyle(mark: ScheduleMark, todayKey: string, onFill = false) {
  const colour = onFill ? Colors.white : markColour(mark, todayKey);
  if (mark.kind === 'next') return { borderColor: colour, borderWidth: 1 };
  // Square, not round — see KIND_COLOURS. Drawn by taking the radius off
  // rather than by a second shape, so the two can never be different sizes.
  if (mark.kind === 'project') return { backgroundColor: colour, borderRadius: 1 };
  return { backgroundColor: colour };
}

/**
 * One dot per kind, rather than one per mark.
 *
 * A day with four things added to it is one slate dot, not four: the cell is
 * 40px and the question it answers is *what sort of day was this*, which the
 * list underneath then answers properly. Capping a per-mark row at three would
 * have dropped the fourth kind silently, which is the worse failure — a day
 * that quietly stops mentioning it has something due.
 */
function dotsFor(marks: ScheduleMark[], todayKey: string): ScheduleMark[] {
  return KIND_DRAW_ORDER.flatMap((kind) => {
    const here = marks.filter((m) => m.kind === kind);
    if (here.length === 0) return [];
    // For a due date, an overdue one speaks for the day if there is one.
    return [here.find((m) => m.snag !== null && m.snag.status !== 'done' && m.day < todayKey) ?? here[0]];
  });
}

/** What happened, then what is coming — both on a cell and down a list. */
const KIND_DRAW_ORDER: ScheduleKind[] = ['filed', 'done', 'due', 'next', 'project'];

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
// Sunday-first, to index straight off `getDay()`.
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];


export default function ScheduleScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { household, properties, profile } = useHousehold();

  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  /**
   * The day being read, or `null` for the whole month.
   *
   * Paging clears it, and that is deliberate: a heading reading "Saturday, 5
   * September" over a grid of November is the screen contradicting itself, and
   * it is also the wrong answer — somebody who has just paged forward is asking
   * what lands in *that month*, not what happened on a day in another one.
   */
  const [selected, setSelected] = useState<string | null>(() => dayKey(today));

  const [snags, setSnags] = useState<Snag[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * No property filter at all, and no status filter either.
   *
   * `getSnags` with no `propertyId` returns every place the caller can read,
   * which `property_members` and the read policies already decide — so this is
   * exactly "the places this person is linked to" without the client having to
   * assemble the list or loop. And every status, because a calendar of only the
   * open ones is missing exactly the half somebody came here to check.
   *
   * One small read: a household's whole history is a few hundred rows — the
   * retired product had 57 across six organisations and two years — so this
   * beats a query per month or a query per place.
   */
  const load = useCallback(async () => {
    try {
      // Projects off takes the punch list with it, exactly as on the List tab:
      // a mark whose row is a door back to a renovation nothing can open is a
      // mark that lies about what it leads to.
      setSnags(await getSnags({ excludeProjectSnags: !profile.projectsEnabled }, 'newest'));
    } catch (err) {
      console.error('Failed to load the schedule:', err);
    }
    try {
      // Separately, and deliberately not fatal: a calendar that cannot draw the
      // renovations is still a calendar, and taking the whole tab down over the
      // addition would be the worse trade. Same rule as the thing-history card
      // on the snag page.
      //
      // Skipped entirely with projects off — the fifth kind of mark is a read
      // of dates set on a page that is no longer reachable.
      setProjects(profile.projectsEnabled ? await getAllProjects() : []);
    } catch (err) {
      console.error('Failed to load the projects:', err);
    }
    setLoading(false);
    setRefreshing(false);
  }, [profile.projectsEnabled]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Coming back from a snag, where a date may have been set or cleared.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const days = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  );

  const marks = useMemo(() => {
    const after = new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate() + 1);
    return scheduleMarks(snags, days[0], after, projects);
  }, [snags, projects, days]);

  const byDay = useMemo(() => {
    const out = new Map<string, ScheduleMark[]>();
    for (const mark of marks) {
      if (!out.has(mark.day)) out.set(mark.day, []);
      out.get(mark.day)!.push(mark);
    }
    return out;
  }, [marks]);

  const todayKey = dayKey(today);
  const monthOf = cursor.getMonth();
  const thisMonth = cursor.getFullYear() === today.getFullYear() && monthOf === today.getMonth();

  /**
   * What the list underneath is showing: one day, or the month.
   *
   * The month case carries the date on each row, because without it a list of
   * nine things under one heading is nine things with no dates on a screen
   * whose whole subject is dates.
   */
  const listed = useMemo(() => {
    if (selected) return marksOn(marks, selected);
    return marks
      .filter((m) => {
        const [, month] = m.day.split('-').map(Number);
        return month - 1 === monthOf;
      })
      .sort((a, b) => a.day.localeCompare(b.day) || KIND_DRAW_ORDER.indexOf(a.kind) - KIND_DRAW_ORDER.indexOf(b.kind));
  }, [marks, selected, monthOf]);

  function step(by: number) {
    setCursor((at) => new Date(at.getFullYear(), at.getMonth() + by, 1));
    setSelected(null);
  }

  // Named for what the screen covers. With a bach in the picture that is not
  // any one place, and a picker here would offer to narrow to the one thing
  // this tab exists not to narrow to.
  const manyPlaces = properties.length > 1;
  const placeName = manyPlaces ? 'Everywhere' : household.name;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.place}>
          <Text style={styles.title}>{placeName}</Text>
        </View>

        {/* Only offered when you are not already there — a button that does
            nothing is a button you have to test to find that out. */}
        {!thisMonth || selected !== todayKey ? (
          <Pressable
            onPress={() => {
              setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelected(todayKey);
            }}
            style={styles.todayBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to this month"
          >
            <Text style={styles.todayLabel}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
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
        <View style={styles.monthRow}>
          <Pressable
            onPress={() => step(-1)}
            style={styles.arrow}
            accessibilityRole="button"
            accessibilityLabel="The month before"
          >
            <Icon name="chevron-back" size="md" color={Colors.textSecondary} />
          </Pressable>
          <Text style={styles.month}>
            {MONTHS[monthOf]} {cursor.getFullYear()}
          </Text>
          <Pressable
            onPress={() => step(1)}
            style={styles.arrow}
            accessibilityRole="button"
            accessibilityLabel="The month after"
          >
            <Icon name="chevron-forward" size="md" color={Colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.weekdays}>
          {WEEKDAYS.map((letter, i) => (
            <Text key={i} style={styles.weekday}>{letter}</Text>
          ))}
        </View>

        <View style={styles.grid}>
          {days.map((date) => {
            const key = dayKey(date);
            const here = byDay.get(key) ?? [];
            const outside = date.getMonth() !== monthOf;
            const on = key === selected;
            return (
              <Pressable
                key={key}
                onPress={() => setSelected(key)}
                style={styles.cell}
                accessibilityRole="button"
                accessibilityLabel={`${date.getDate()} ${MONTHS[date.getMonth()]}${
                  here.length > 0 ? `, ${here.length} item${here.length === 1 ? '' : 's'}` : ''
                }`}
                accessibilityState={{ selected: on }}
              >
                <View style={[styles.day, on && styles.dayOn, !on && key === todayKey && styles.dayToday]}>
                  <Text
                    style={[
                      styles.dayNumber,
                      outside && styles.dayNumberOutside,
                      on && styles.dayNumberOn,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                  <View style={styles.dots}>
                    {dotsFor(here, todayKey).map((mark) => (
                      <View
                        key={mark.kind}
                        // Hollow for a projection: it is arithmetic off a
                        // repeat, not a row anything has written.
                        style={[styles.dot, dotStyle(mark, todayKey, on)]}
                      />
                    ))}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legend}>
          {(['filed', 'done', 'due', 'next', 'project'] as ScheduleKind[]).map((kind) => (
            <View key={kind} style={styles.legendItem}>
              <View
                style={[
                  styles.dot,
                  kind === 'next'
                    ? { borderColor: KIND_COLOURS.next, borderWidth: 1 }
                    : kind === 'project'
                      ? { backgroundColor: KIND_COLOURS.project, borderRadius: 1 }
                      : { backgroundColor: KIND_COLOURS[kind] },
                ]}
              />
              <Text style={styles.legendLabel}>{SCHEDULE_KIND_LABELS[kind]}</Text>
            </View>
          ))}
        </View>

        <View style={styles.dayHead}>
          <Text style={styles.dayTitle}>
            {selected
              ? describeDay(selected, todayKey)
              : `All of ${MONTHS[monthOf]}`}
          </Text>
          <View style={styles.dayRule} />
        </View>

        {listed.length === 0 ? (
          loading ? null : (
            <EmptyState
              icon="calendar-outline"
              title={selected ? 'Nothing on this day' : `Nothing in ${MONTHS[monthOf]}`}
              message="Dates come from a snag's due date and from when it was added or finished."
            />
          )
        ) : (
          listed.map((mark, i) => (
            <Pressable
              key={`${mark.snag?.id ?? mark.project?.id}-${mark.kind}-${i}`}
              onPress={() =>
                mark.snag
                  ? navigation.navigate('SnagDetail', { snagId: mark.snag.id })
                  : mark.project
                    ? navigation.navigate('ProjectDetail', { projectId: mark.project.id })
                    : undefined
              }
              style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={
                mark.snag ? snagHeadline(mark.snag) : mark.project?.name ?? 'Project'
              }
            >
              <View
                style={[styles.rowDot, dotStyle(mark, todayKey)]}
              />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {mark.snag ? snagHeadline(mark.snag) : mark.project?.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {/* The date leads when the list is a whole month; on one day
                      it is the heading and repeating it on every row is noise. */}
                  {selected ? '' : `${shortDay(mark.day)} · `}
                  {/* A project's row says which of its three dates this is —
                      "Started", "Finished", "Aiming to finish" — because they
                      are three different claims and one word for all of them
                      would be the tab inventing a state. */}
                  {mark.note ?? SCHEDULE_KIND_LABELS[mark.kind]}
                  {/* Which house, ahead of which room: with two places on one
                      calendar, "Roof" alone is ambiguous in the way that
                      actually matters. */}
                  {manyPlaces ? ` · ${mark.snag?.propertyName ?? mark.project?.propertyName}` : ''}
                  {mark.snag?.room ? ` · ${mark.snag.room}` : ''}
                  {/* Said the way the snag says it — "every 6 months", never
                      "180 days". `describeCycle` is shared with triage so the
                      two cannot word the same arrangement differently. */}
                  {mark.snag?.repeatDays ? ` · every ${describeCycle(mark.snag.repeatDays)}` : ''}
                </Text>
              </View>
              <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
            </Pressable>
          ))
        )}
      </ScrollView>

    </View>
  );
}

/**
 * Dates are worded here rather than by `toLocaleDateString`.
 *
 * A browser's locale is the locale of whoever set the phone up, not of the
 * house the app is describing — and the default formatting puts the month
 * before the day, which is not how anybody in this app's one market reads a
 * date out loud. The month names above are already spelled out for the same
 * reason; this keeps the two headings in one voice.
 */

/** "Tue 8" — enough to place a row inside a month already named above it. */
function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()]} ${d}`;
}

/** "Today", or the date spelled out. A date nobody can place is not a heading. */
function describeDay(day: string, todayKey: string): string {
  if (day === todayKey) return 'Today';
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAY_LONG[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  // V2: the iOS large title, the same on every tab.
  title: {
    fontSize: Typography.largeTitle, lineHeight: 41, fontWeight: Typography.bold,
    color: Colors.textPrimary, letterSpacing: -0.4,
  },
  todayBtn: {
    minHeight: MIN_TOUCH_TARGET - Spacing.md,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  todayLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textSecondary },
  scroll: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxxl },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  month: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  weekdays: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.6,
    color: Colors.textMuted,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // A seventh of the row, so the grid divides exactly at any width. The tap
  // target is the cell; the circle inside it is what gets the fill, the same
  // arrangement the chip rails use.
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: Spacing.xs },
  day: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOn: { backgroundColor: Colors.primary },
  dayToday: { backgroundColor: Colors.sunken },
  dayNumber: { fontSize: Typography.sm, color: Colors.textPrimary },
  // Still drawn, still tappable: the fortnight either side of a month change is
  // when "is anything landing that weekend" gets asked.
  dayNumberOutside: { color: Colors.textMuted, opacity: 0.5 },
  dayNumberOn: { color: Colors.white, fontWeight: Typography.semibold },
  dots: { flexDirection: 'row', gap: 2, height: 6, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  legendLabel: { fontSize: Typography.xs, color: Colors.textMuted },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  dayTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    letterSpacing: -0.2,
    color: Colors.textMuted,
  },
  dayRule: { flex: 1, height: 1, backgroundColor: Colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    // V2: white on plaster is the card; no outline.
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
  },
  rowDot: { width: 8, height: 8, borderRadius: 4 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: Typography.base, color: Colors.textPrimary },
  rowMeta: { fontSize: Typography.sm, color: Colors.textMuted },
});
