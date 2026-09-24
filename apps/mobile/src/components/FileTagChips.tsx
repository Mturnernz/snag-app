import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { FILE_TAGS, FILE_TAG_LABELS, type FileTag } from '@snag/shared-types';

interface Props {
  value: FileTag | null;
  /** The chip pressed; pressing the lit one again answers `null`. */
  onChange: (next: FileTag | null) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}

/**
 * What a file is, as a row of chips that wraps.
 *
 * The app's one chip shape — a sunken well, solid fern on the one that is
 * true, ~34px inside a 48px target — and wrapping rather than a segmented
 * track, because four labels as long as *Compliance certificate* do not fit
 * across a phone. Pressing the lit chip clears it, as every chip row here does,
 * so *untagged* needs no chip of its own.
 */
export default function FileTagChips({ value, onChange, accessibilityLabel, disabled = false }: Props) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {FILE_TAGS.map((tag) => {
        const on = value === tag;
        return (
          <Pressable
            key={tag}
            onPress={() => onChange(on ? null : tag)}
            disabled={disabled}
            style={styles.tap}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={FILE_TAG_LABELS[tag]}
          >
            <View style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.label, on && styles.labelOn]}>{FILE_TAG_LABELS[tag]}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.xs },
  tap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    justifyContent: 'center',
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  label: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textSecondary },
  labelOn: { color: Colors.white },
});
