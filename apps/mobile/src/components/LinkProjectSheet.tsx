import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { getProjects, projectSubtitle } from '../lib/supabase';
import { Project, PROJECT_STATUS_LABELS } from '../types';

interface Props {
  visible: boolean;
  /** Which place's projects. Keyed by the snag's own property, never the tab's. */
  propertyId: string | null;
  linkedId: string | null;
  onClose: () => void;
  onPick: (projectId: string) => Promise<void>;
}

/**
 * Which renovation a job belongs to.
 *
 * **Read when the sheet opens, never on page load.** This is a
 * once-in-a-job's-life decision on a page people open constantly — the same
 * rule `LinkThingSheet` follows, and for the same reason.
 *
 * **Keyed by the snag's own property**, so it can never offer the bach's
 * renovation for a job at the house. The server refuses that anyway
 * (`create_snag` and `update_snag` both check), but an offer that is going to
 * be refused is an offer that should not have been made.
 *
 * Finished projects are offered too, deliberately: the cistern that started
 * dripping in October belongs to the bathroom renovation that finished in
 * March, and that is exactly the link worth having — it is what makes the
 * workmanship guarantee findable.
 */
export default function LinkProjectSheet({ visible, propertyId, linkedId, onClose, onPick }: Props) {
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    if (!visible || !propertyId) return;
    let cancelled = false;
    setProjects(null);
    getProjects(propertyId)
      .then((loaded) => !cancelled && setProjects(loaded))
      .catch(() => !cancelled && setProjects([]));
    return () => {
      cancelled = true;
    };
  }, [visible, propertyId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.grab} />
        <Text style={styles.title}>Part of which job?</Text>

        {projects === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : projects.length === 0 ? (
          <Text style={styles.empty}>
            No projects at this place yet. Start one on the Projects tab and this job can belong
            to it.
          </Text>
        ) : (
          <ScrollView style={styles.scroll}>
            {projects.map((project) => {
              const on = project.id === linkedId;
              return (
                <Pressable
                  key={project.id}
                  onPress={() => onPick(project.id)}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={project.name}
                >
                  <View style={styles.rowTitles}>
                    <Text style={[styles.rowName, on && styles.rowNameOn]} numberOfLines={1}>
                      {project.name}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {PROJECT_STATUS_LABELS[project.status]}
                      {projectSubtitle(project) ? ` · ${projectSubtitle(project)}` : ''}
                    </Text>
                  </View>
                  {on ? <Icon name="checkmark" size="md" color={Colors.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
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
    maxHeight: '70%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  title: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  loading: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  empty: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 20, paddingVertical: Spacing.md },
  scroll: { marginBottom: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowTitles: { flex: 1, minWidth: 0 },
  rowName: { fontSize: Typography.base, color: Colors.textPrimary },
  rowNameOn: { color: Colors.primary, fontWeight: Typography.semibold },
  rowSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
});
