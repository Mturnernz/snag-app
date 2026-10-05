import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from './Icon';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import { useHousehold } from '../hooks/useHousehold';
import { Colors, MIN_TOUCH_TARGET, Radius, Spacing, Typography } from '../constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Which home the app is showing — the house, the bach, a parent's place.
 *
 * A home is a household with one place, so this list is every household this
 * person is in, and picking one switches the household, its people and its
 * place together (`useHousehold`). One sheet for every tab whose header opens
 * it, so the List, House, Projects and Schedule tabs cannot offer the choice
 * three different ways — they had a house icon, radio buttons and a tick.
 */
export default function HomePickerSheet({ visible, onClose }: Props) {
  const insets = useEdgeInsets();
  const { properties, activeProperty, setActiveProperty } = useHousehold();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.grab} />
        <Text style={styles.title}>Which home</Text>
        {properties.map((home) => {
          const on = activeProperty?.id === home.id;
          return (
            <Pressable
              key={home.id}
              onPress={() => {
                setActiveProperty(home.id);
                onClose();
              }}
              style={styles.row}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Icon name={on ? 'home' : 'home-outline'} size="md" color={on ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.label, on && styles.labelOn]}>{home.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card + 6,
    borderTopRightRadius: Radius.card + 6,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  title: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: MIN_TOUCH_TARGET },
  label: { fontSize: Typography.base, color: Colors.textSecondary },
  labelOn: { color: Colors.textPrimary, fontWeight: Typography.semibold },
});
