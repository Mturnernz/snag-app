import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import Icon from './Icon';
import { Colors, MIN_TOUCH_TARGET, Spacing, Typography } from '../constants/theme';
import { SCHEMES, SCHEME_ORDER, type SchemeId } from '../constants/schemes';

interface Props {
  current: SchemeId;
  onChoose: (id: SchemeId) => void;
}

/**
 * The colour schemes, as swatches: each one's action colour on its own ground,
 * named beneath. A choice already made is ink — a ring and a tick — because the
 * action colour is for doing, not for marking what is chosen. Pressing the one
 * already lit does nothing.
 */
export default function SchemePicker({ current, onChoose }: Props) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {SCHEME_ORDER.map((id) => {
        const scheme = SCHEMES[id];
        const on = id === current;
        return (
          <Pressable
            key={id}
            onPress={() => { if (!on) onChoose(id); }}
            style={styles.choice}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${scheme.label} colour scheme`}
          >
            <View style={[styles.ring, on && styles.ringOn]}>
              <View style={[styles.ground, { backgroundColor: scheme.bone }]}>
                <View style={[styles.swatch, { backgroundColor: scheme.primary }]}>
                  {on ? <Icon name="checkmark" size="sm" color={Colors.white} /> : null}
                </View>
              </View>
            </View>
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>{scheme.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  choice: { alignItems: 'center', gap: Spacing.xs, minWidth: MIN_TOUCH_TARGET + 4, minHeight: MIN_TOUCH_TARGET },
  ring: { padding: 3, borderRadius: 999, borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: Colors.selected },
  ground: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.hairline,
  },
  swatch: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: Typography.footnote, color: Colors.textSecondary },
  labelOn: { color: Colors.textPrimary, fontWeight: Typography.semibold },
});
