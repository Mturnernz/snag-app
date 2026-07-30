import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Typography, Shadow, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from './Button';
import Icon from './Icon';

interface Props {
  visible: boolean;
  title: string;
  /** Optional line under the title explaining what this record is for. */
  subtitle?: string;
  /** Primary action label. Omit for a read-only sheet. */
  submitLabel?: string;
  onSubmit?: () => void;
  submitting?: boolean;
  submitDisabled?: boolean;
  onClose: () => void;
  /** Set false for a sheet that must be answered: drops the backdrop tap, the
   *  close X and the Android back dismissal, leaving the actions in the body as
   *  the only way out. Used by the serious-lane triage prompt, where skipping is
   *  how a hazard ends up with nobody running the investigation. */
  dismissible?: boolean;
  children: React.ReactNode;
}

// A bottom sheet for capturing one record at a time.
//
// The investigation panels used to render every add-form inline and all at
// once — witness name, witness statement, evidence caption, root cause — so
// three text inputs sat on screen together, each about a third of the width
// of the phone, with no clear commitment point and a keyboard covering
// whichever one you touched. Giving a single record the whole screen is what
// actually fixes that; making the inline fields bigger would not have.
export default function Sheet({
  visible, title, subtitle, submitLabel, onSubmit, submitting, submitDisabled, onClose,
  dismissible = true, children,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // A real pixel cap, not a percentage: `maxHeight: '88%'` resolves against
  // the parent's height, and the wrapper here is auto-sized, so the
  // percentage silently did nothing and the sheet overflowed the screen
  // instead of scrolling inside itself.
  const maxHeight = Math.round(height * 0.86);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={dismissible ? onClose : undefined}
    >
      <View style={styles.overlay}>
        {/* Tapping the dimmed area behind the sheet dismisses it. */}
        {dismissible
          ? <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
          : <View style={styles.backdrop} />}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.lift}
        >
          <View style={[styles.sheet, { maxHeight, paddingBottom: insets.bottom + Spacing.lg }]}>
            {/* The grabber advertises a swipe-to-dismiss that isn't there when
                the sheet has to be answered. */}
            {dismissible && <View style={styles.grabber} />}

            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              {dismissible && (
                <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.close}>
                  <Icon name="close" size="md" color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>

            {submitLabel && onSubmit && (
              <Button
                label={submitLabel}
                onPress={onSubmit}
                loading={submitting}
                disabled={submitDisabled}
                fullWidth
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17, 24, 39, 0.5)' },
  lift: { justifyContent: 'flex-end' },

  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
    ...Shadow.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
  },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -Spacing.sm,
    marginRight: -Spacing.sm,
  },

  // Shrink rather than refuse to grow: the sheet should expand toward its
  // maxHeight to fit the fields, and only then start scrolling. flexGrow: 0
  // here left the last field stranded below the fold on first open, which is
  // the same "where did my input go" problem the sheet exists to solve.
  body: { flexShrink: 1 },
  bodyContent: { gap: Spacing.sm, paddingBottom: Spacing.xs },
});
