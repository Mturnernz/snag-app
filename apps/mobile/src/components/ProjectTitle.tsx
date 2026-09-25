import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import Icon from './Icon';
import { groupedStyles } from './Grouped';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

/** The column's own limit (`projects_name_check`), so the box cannot take more than the row can hold. */
const NAME_LIMIT = 80;

interface Props {
  name: string;
  /** Writes the new name. A throw keeps the box open with the words still in it. */
  onRename: (next: string) => Promise<void>;
}

/**
 * A project's name, and the one place it can be changed.
 *
 * It was asked once, on the first step of starting a project, and never again —
 * so "Roof" stayed "Roof" once the job had grown gutters. The title is a door
 * now: a press (on the words or the pencil beside them) turns it into a box in
 * the same large type, where it stands.
 *
 * **It follows the app's one rule for saving**: a box writes when it is left.
 * Return, tapping away, and leaving the page all write what is in it, and a
 * name that has not changed writes nothing. An emptied box puts the old name
 * back rather than storing nothing — the rule an item's own title box already
 * follows — and the box stops at the column's 80 characters rather than letting
 * the server refuse what was typed.
 *
 * A one-box sheet with a Save button was the other shape, and it is the shape
 * the saving rule keeps for sheets editing two fields together.
 */
export default function ProjectTitle({ name, onRename }: Props) {
  const navigation = useNavigation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  // Read by blur, submit and leaving the page, any two of which can arrive for
  // one gesture: the first commits and the rest find nothing to do.
  const open = useRef(false);
  const draftRef = useRef(name);

  useEffect(() => {
    if (!open.current) {
      setDraft(name);
      draftRef.current = name;
    }
  }, [name]);

  async function commit() {
    if (!open.current) return;
    open.current = false;
    const next = draftRef.current.trim();
    if (!next || next === name) {
      setDraft(name);
      draftRef.current = name;
      setEditing(false);
      setError(null);
      return;
    }
    setEditing(false);
    try {
      await onRename(next);
      setError(null);
    } catch (err: unknown) {
      open.current = true;
      setEditing(true);
      setError(err instanceof Error ? err.message : 'That name didn’t save');
    }
  }

  // Leaving the page writes whatever is still in the box. A press does not
  // reliably blur a box on native, and the back gesture is exactly that.
  useEffect(() => {
    if (!editing) return undefined;
    return navigation.addListener('beforeRemove', () => { commit(); });
  }, [editing, navigation, name]);

  function start() {
    open.current = true;
    draftRef.current = name;
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  if (editing) {
    return (
      <View style={styles.wrap}>
        <TextInput
          style={[groupedStyles.largeTitle, styles.input]}
          value={draft}
          onChangeText={(text) => { draftRef.current = text; setDraft(text); }}
          onBlur={commit}
          onSubmitEditing={commit}
          autoFocus
          maxLength={NAME_LIMIT}
          returnKeyType="done"
          accessibilityLabel="Project name"
        />
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </View>
    );
  }

  return (
    <Pressable
      onPress={start}
      style={styles.title}
      accessibilityRole="button"
      accessibilityLabel={`${name}. Rename this project`}
    >
      <Text style={[groupedStyles.largeTitle, styles.name]} accessibilityRole="header">{name}</Text>
      <View style={styles.pencil}>
        <Icon name="pencil-outline" size={20} color={Colors.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  title: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  // `minWidth: 0` so a long name wraps beside the pencil instead of pushing it
  // off the screen, which on web a flexed text will otherwise do.
  name: { flexShrink: 1, minWidth: 0 },
  // The glyph is 20pt; the box around it is the 48pt minimum, pulled back so
  // the title line stays the height of the title.
  pencil: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, marginVertical: -4,
    alignItems: 'center', justifyContent: 'center',
  },
  input: {
    borderBottomWidth: 1, borderBottomColor: Colors.separator, paddingVertical: 0,
    minWidth: 0,
  },
  error: { fontSize: Typography.sm, color: Colors.danger },
});
