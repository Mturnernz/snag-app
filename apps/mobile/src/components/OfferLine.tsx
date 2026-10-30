import React from 'react';
import { View, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  title: string;
  /** What saving does, in words — the ticked answer or the unticked one. */
  note: string;
  ticked: boolean;
  onToggle: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * One thing a waiting card offers to do as it lands — link a claim to its
 * contract, record what the paper says was paid before it. `PaysOffLine`'s
 * shape: **ticked when it arrives, and a tap takes it back**, and the line
 * under the title says what the tick does, so nothing it writes is a surprise.
 * Nothing is written until the card itself is allocated.
 */
export default function OfferLine({ title, note, ticked, onToggle, style }: Props) {
  return (
    <View style={[styles.box, style]}>
      <Pressable
        onPress={onToggle}
        style={styles.tap}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked }}
        accessibilityLabel={title}
      >
        <Icon
          name={ticked ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={ticked ? Colors.primary : Colors.textMuted}
        />
        <View style={styles.body}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.note}>{note}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: Radius.input, backgroundColor: Colors.sunken, paddingHorizontal: Spacing.md, marginTop: Spacing.sm },
  tap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: MIN_TOUCH_TARGET, paddingVertical: Spacing.sm },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textPrimary },
  note: { fontSize: Typography.footnote, lineHeight: 18, color: Colors.textMuted },
});
