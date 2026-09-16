import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import Button from './Button';
import Icon from './Icon';
import { Colors, Radius, Shadow, Spacing, Typography } from '../constants/theme';

interface Props {
  visible: boolean;
  /** What was finished, in the words the list showed. */
  headline: string;
  onClose: () => void;
}

/**
 * The one moment this app says well done.
 *
 * **It only appears when a snag has actually finished.** A repeating job never
 * reaches 'done' — `home.set_snag_status` rolls `due_at` forward and leaves it
 * open — so congratulating somebody for changing the heat pump filter would be
 * congratulating them for a job that is back on the list before they have put
 * the phone down. That case keeps the toast it already had, which says what
 * actually happened. The caller decides; this only draws.
 *
 * **One button, and it goes back to the list**, because that is the only thing
 * anybody wants next: the snag underneath has just gone neutral and left, and
 * the reward the product has always offered is the list being shorter. This says
 * it out loud as well now. Deliberately not `showAlert` — that is a
 * `window.confirm` on the build people install, which cannot congratulate
 * anybody and cannot carry a tick.
 *
 * The tick is fern because this is an *interaction*, not a state: the snag's own
 * `StatusBadge` still goes neutral, since fern is the brand and the list's
 * calmest state must not be its loudest colour.
 */
export default function DoneDialog({ visible, headline, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.medal}>
            <Icon name="checkmark-circle" size="xl" color={Colors.primary} />
          </View>
          <Text style={styles.title}>Congratulations</Text>
          <Text style={styles.message}>
            {headline} is done. One less thing.
          </Text>
          <Button label="Return to list" onPress={onClose} fullWidth />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    gap: Spacing.sm,
    alignItems: 'center',
    ...Shadow.lg,
  },
  medal: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  message: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
});
