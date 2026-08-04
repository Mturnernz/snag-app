import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import { ReportSite } from '../lib/reportSite';
import Icon from './Icon';

interface Props {
  sites: ReportSite[];
  value: ReportSite | null;
  onChange: (site: ReportSite) => void;
  /** Field label above (or, inline, beside) the control. */
  label?: string;
  /** 'inline' puts the label on the control's own row instead of above it —
   *  a row of vertical space back on a form that has to fit one screen. */
  layout?: 'stacked' | 'inline';
}

/**
 * Which site this report goes to — a dropdown in the form's own field style
 * (label, bordered control, chevron), not a pill or a bottom sheet: it is one
 * of the report's fields, and it should read like the ones above and below it.
 *
 * The list opens inline under the control rather than as an overlay. React
 * Native has no anchored-menu primitive, and an absolutely positioned one
 * inside a ScrollView clips on Android and misplaces itself on the web build —
 * the form simply grows while the list is open, which costs nothing on a
 * scrolling form.
 *
 * Rendered by the caller only when there's a choice to make: a reporter on one
 * site has nothing to pick.
 */
export default function SitePicker({ sites, value, onChange, label = 'Site', layout = 'stacked' }: Props) {
  const [open, setOpen] = useState(false);
  const inline = layout === 'inline';

  return (
    <View style={inline ? styles.fieldInline : styles.field}>
      {/* Inline, the label is boxed to the control's own height so it stays
          level with it rather than drifting to the centre of control + open
          menu. */}
      <View style={inline ? styles.labelBoxInline : undefined}>
        <Text style={styles.label}>{label}</Text>
      </View>

      {/* The control and its menu are one column so the menu hangs off the
          control's edges, whichever side of it the label is on. */}
      <View style={inline ? styles.controlWrapInline : undefined}>
        <TouchableOpacity
          style={[styles.control, open && styles.controlOpen]}
          onPress={() => setOpen((prev) => !prev)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${label}: ${value?.name ?? 'choose a site'}`}
        >
          <Icon name="location-outline" size="sm" color={Colors.textMuted} />
          <Text style={[styles.controlText, !value && styles.placeholder]} numberOfLines={1}>
            {value?.name ?? 'Choose a site'}
          </Text>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
        </TouchableOpacity>

        {open && (
          <View style={styles.menu}>
            {sites.map((site) => {
              const selected = site.id === value?.id;
              return (
                <TouchableOpacity
                  key={site.id}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => { setOpen(false); onChange(site); }}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]} numberOfLines={1}>
                    {site.name}
                  </Text>
                  {selected && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.sm,
  },
  fieldInline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  labelBoxInline: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  controlWrapInline: {
    flex: 1,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  // Open: the control and the list below it read as one surface.
  controlOpen: {
    borderColor: Colors.primary,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  controlText: {
    flex: 1,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  placeholder: {
    fontWeight: Typography.regular,
    color: Colors.textMuted,
  },
  menu: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: Colors.primary,
    borderBottomLeftRadius: Radius.input,
    borderBottomRightRadius: Radius.input,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  optionSelected: {
    backgroundColor: Colors.primaryLight,
  },
  optionText: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  optionTextSelected: {
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
});
