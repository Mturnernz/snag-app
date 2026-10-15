import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import SignedImage from './SignedImage';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import DueBadge from './DueBadge';
import { Colors, Fonts, Radius, SETTLED_OPACITY, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { Snag } from '../types';
import { isDoneForNow, snagHeadline, unboughtParts } from '@snag/supabase-queries';

interface Props {
  snag: Snag;
  photoUrl?: string | null;
  onPress: () => void;
  /**
   * Finishing from the list, without opening the job.
   *
   * Marking something done is the most common thing anybody does to a job
   * that already exists, and it was four actions and a scroll away: open it,
   * scroll past every card, *Mark done*, *Return to list*. Absent on anything
   * that is done, or parked until it comes round again — there is nothing to
   * finish there.
   */
  onDone?: () => void;
  /** While the finish is on its way, so a second tap cannot send a second. */
  finishing?: boolean;
  /** A long press starts choosing jobs to share. */
  onLongPress?: () => void;
  /**
   * Whether the list is choosing jobs. The card's tap then chooses rather than
   * opens, and the tick on the right becomes a checkbox — still a sibling of
   * the card's door, never inside it.
   */
  selecting?: boolean;
  selected?: boolean;
  /** Toggles this card while choosing. */
  onSelect?: () => void;
  /** Off under the room's own heading, where the room would be said twice. */
  showRoom?: boolean;
  /** Notes somebody else has written since the last visit — news on the list. */
  newNotes?: number;
}

/**
 * A job in the list, as a Bone & Glass row: the photo at 56pt, the headline,
 * one line of facts, and the tick.
 *
 * **Hairlines, not boxes.** It was a white card with a shadow; it is a row on
 * the bone ground now, split from the next by a hairline, because twelve
 * shadowed cards is a wall of boxes and the photographs are what should stand
 * out. The photo is still the point — it leads every row — and *New* shows the
 * other person's jobs as large photo cards (`PhotoCard`) above the rows.
 *
 * The facts are state marks (a dot and a word), what is still to get, and the
 * notes; the room in mono when the row is not already under its room.
 */
export default function SnagCard({
  snag, photoUrl, onPress, onDone, finishing, onLongPress, selecting = false, selected = false, onSelect,
  showRoom = true, newNotes = 0,
}: Props) {
  const done = snag.status === 'done';
  // A repeating job that has been done and is waiting for its next turn gets
  // the same translucency, because it is the same fact: there is nothing to do
  // about it. It cannot leave the list the way a finished snag does, so dimming
  // is the only reward available — see `isDoneForNow`.
  const settled = done || isDoneForNow(snag);
  // No title field exists: a photo-only snag is named by where it is.
  const headline = snagHeadline(snag);
  const toGet = unboughtParts(snag);

  return (
    <View style={[styles.row, settled && !selecting && styles.settled]}>
    {/* The tick is a sibling of the door, never inside it: a Pressable inside
        a Pressable is a coin toss about which one gets the tap. */}
    <Pressable
      onPress={selecting ? onSelect : onPress}
      onLongPress={selecting ? undefined : onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [styles.open, pressed && styles.pressed]}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={`${headline}${snag.room ? `, ${snag.room}` : ''}`}
      accessibilityActions={onLongPress && !selecting ? [{ name: 'longpress', label: 'Choose jobs to share' }] : undefined}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') onLongPress?.(); }}
    >
      <View style={styles.thumb}>
        {photoUrl ? (
          <SignedImage uri={photoUrl} style={styles.image} resizeMode="cover" />
        ) : (
          // A job with no photograph gets the notes glyph in a well, never an
          // empty image frame.
          <View style={styles.noPhoto}>
            <Icon name="chatbubble-outline" size="md" color={Colors.textMuted} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            done && styles.doneTitle,
            !snag.description && styles.titleImplied,
          ]}
          numberOfLines={2}
        >
          {headline}
        </Text>

        <View style={styles.facts}>
          <StatusBadge status={snag.status} />
          <DueBadge snag={snag} />
          {showRoom && snag.room ? <Text style={styles.room} numberOfLines={1}>{snag.room}</Text> : null}
          {/* What is still to get, never what was listed: a row claiming it
              needs the seal you bought on Saturday is a row you stop
              believing. It goes when the trip is done. */}
          {toGet.length > 0 ? (
            <View style={styles.fact}>
              <Icon name="cart-outline" size="sm" color={Colors.textSecondary} />
              <Text style={styles.factText} numberOfLines={1}>
                {toGet.length === 1 ? toGet[0] : `${toGet.length} things to get`}
              </Text>
            </View>
          ) : null}
          {newNotes > 0 ? (
            <View style={styles.fact}>
              <Icon name="chatbubble-outline" size="sm" color={Colors.primary} />
              <Text style={[styles.factText, styles.news]}>
                {newNotes === 1 ? 'New note' : `${newNotes} new notes`}
              </Text>
            </View>
          ) : snag.commentCount > 0 ? (
            <View style={styles.fact}>
              <Icon name="chatbubble-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.factText}>{snag.commentCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>

    {selecting ? (
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [styles.tick, pressed && styles.pressed]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${selected ? 'Unselect' : 'Select'}: ${headline}`}
      >
        {/* A choice is ink, not the action colour: fern is for doing. */}
        <View style={[styles.box, selected && styles.boxOn]}>
          {selected ? <Icon name="checkmark" size="sm" color={Colors.onSelected} /> : null}
        </View>
      </Pressable>
    ) : onDone && !settled ? (
      <Pressable
        onPress={onDone}
        disabled={finishing}
        style={({ pressed }) => [styles.tick, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Mark done: ${headline}`}
      >
        <View style={[styles.tickRing, finishing && styles.tickRingBusy]}>
          <Icon
            name="checkmark"
            size="sm"
            color={finishing ? Colors.textMuted : Colors.primary}
          />
        </View>
      </Pressable>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.hairline,
  },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  pressed: { opacity: 0.7 },
  // An outline circle in the action colour: an interaction, which is what the
  // action colour is for — and hollow, because nothing is done until pressed.
  tick: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginRight: -Spacing.sm,
  },
  tickRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.75,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickRingBusy: { borderColor: Colors.hairline },
  box: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.75,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: Colors.selected, borderColor: Colors.selected },
  settled: { opacity: SETTLED_OPACITY },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: Radius.thumb,
    overflow: 'hidden',
    backgroundColor: Colors.well,
  },
  image: { width: '100%', height: '100%' },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Spacing.xs + 2, minWidth: 0 },
  title: {
    fontSize: Typography.body,
    lineHeight: 22,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    letterSpacing: -0.17,
  },
  doneTitle: { textDecorationLine: 'line-through', color: Colors.textSecondary },
  // A headline the app supplied rather than one somebody wrote. Lighter, so
  // the eye goes to the photograph — which is the actual report.
  titleImplied: { fontWeight: Typography.medium, color: Colors.textSecondary },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.md, rowGap: Spacing.xs },
  room: {
    fontFamily: Fonts.mono,
    fontSize: Typography.label,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    flexShrink: 1,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  factText: { fontSize: Typography.footnote, color: Colors.textSecondary, flexShrink: 1 },
  news: { color: Colors.primary, fontWeight: Typography.semibold },
});
