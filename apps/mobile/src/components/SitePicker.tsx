import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';

import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import { ReportSite } from '../lib/reportSite';
import Icon from './Icon';

interface Props {
  sites: ReportSite[];
  value: ReportSite | null;
  onChange: (site: ReportSite) => void;
  /** The pill's caption. "Reporting from" on the niggle form; the serious
   *  lane asks about the site of an event rather than the reporter. */
  label?: string;
}

/**
 * Which site this report goes to. Deliberately shaped like the org pill it
 * sits under on the report screen — the two answer the same kind of question
 * ("where is this going?") and were both invisible before, though only the org
 * one was ever adjustable.
 *
 * Rendered by the caller only when there's a choice to make: a reporter on one
 * site has nothing to pick, and a row that can't change anything is noise on a
 * form whose whole point is speed.
 */
export default function SitePicker({ sites, value, onChange, label = 'Reporting from' }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={styles.pill}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value?.name ?? 'no site selected'}. Change site.`}
      >
        <Icon name="location-outline" size="sm" color={Colors.primary} />
        <View style={styles.pillText}>
          <Text style={styles.pillLabel}>{label}</Text>
          <Text style={styles.pillSite} numberOfLines={1}>{value?.name ?? 'Choose a site'}</Text>
        </View>
        <View style={styles.pillChangeRow}>
          <Text style={styles.pillChange}>Change</Text>
          <Icon name="chevron-down" size="sm" color={Colors.primary} />
        </View>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity style={styles.modalSheet} activeOpacity={1}>
            <Text style={styles.modalTitle}>Which site?</Text>
            <Text style={styles.modalHint}>This report goes to the team at the site you pick.</Text>
            {sites.map((site) => (
              <TouchableOpacity
                key={site.id}
                style={styles.option}
                onPress={() => { setOpen(false); onChange(site); }}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: site.id === value?.id }}
              >
                <Text style={styles.optionName}>{site.name}</Text>
                {site.id === value?.id && <Icon name="checkmark" size="md" color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  pillText: {
    flex: 1,
    gap: 1,
    alignItems: 'center',
  },
  pillLabel: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  pillSite: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  pillChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  pillChange: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  modalTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  modalHint: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET,
  },
  optionName: {
    flex: 1,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
});
