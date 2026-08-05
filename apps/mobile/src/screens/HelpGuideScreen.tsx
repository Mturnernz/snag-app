import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';

import {
  GUIDE_PDF_PATH_BY_ROLE,
  GUIDE_VERSION,
  sectionsForRole,
  type GuideBlock,
  type GuideSection,
} from '@snag/onboarding-guide';

import { UserRole, ROLE_LABELS, RootStackParamList } from '../types';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET, Shadow } from '../constants/theme';
import { PORTAL_URL } from '../lib/appUrl';
import { supabase } from '../lib/supabase';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Icon from '../components/Icon';

// The onboarding guide, on the phone.
//
// Content comes from @snag/onboarding-guide — the same source the portal's
// /help page and the printed PDFs render, so the three can't drift. Filtering
// is by section (`sectionsForRole`): a role never sees instructions for a
// control it doesn't have.
//
// Deliberately *not* built on StepCard, even though the collapsed-header-plus-
// summary shape is identical: StepCard's leading dot means done/in-progress/
// pending, and a guide section has no such state. Borrowing it would put a
// progress signal on something that never progresses.
export default function HelpGuideScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<RootStackParamList, 'HelpGuide'>>();
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  // Opens on the section the caller asked for — the walkthrough's "Read more",
  // and the same idea as the portal's `?section=`. Single-open, so naming one
  // is enough to answer "which section" without also scrolling.
  const [expanded, setExpanded] = useState<string | null>(route.params?.section ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setRole((data?.role as UserRole) ?? 'worker');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Someone reading the guide signed out (or before their profile loads) is
  // still a reader — show them the Crew guide rather than a spinner that never
  // resolves into anything.
  const effectiveRole: UserRole = role ?? 'worker';
  const sections = sectionsForRole(effectiveRole);

  function openPdf() {
    Linking.openURL(PORTAL_URL + GUIDE_PDF_PATH_BY_ROLE[effectiveRole]);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Help & guide" />
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Help & guide" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
      >
        <Card variant="elevated" style={styles.intro}>
          <Text style={styles.introTitle}>How SNAG works</Text>
          <Text style={styles.introBody}>
            Written for your role — you&apos;re signed in as {ROLE_LABELS[effectiveRole]}, so this
            shows the {sections.length} sections that apply to you.
          </Text>
        </Card>

        {sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            expanded={expanded === section.id}
            onToggle={() => setExpanded((cur) => (cur === section.id ? null : section.id))}
          />
        ))}

        <TouchableOpacity style={styles.pdfRow} onPress={openPdf} activeOpacity={0.7}>
          <Icon name="download-outline" size="md" color={Colors.primary} />
          <View style={styles.pdfText}>
            <Text style={styles.pdfTitle}>Download this guide (PDF)</Text>
            <Text style={styles.pdfHint}>
              The {ROLE_LABELS[effectiveRole]} handout — printable for inductions.
            </Text>
          </View>
          <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
        </TouchableOpacity>

        <Text style={styles.version}>Guide version {GUIDE_VERSION}</Text>
      </ScrollView>
    </View>
  );
}

function SectionCard({
  section,
  expanded,
  onToggle,
}: {
  section: GuideSection;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card variant="elevated" style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {!expanded && (
            <Text style={styles.sectionSummary} numberOfLines={2}>{section.summary}</Text>
          )}
        </View>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.sectionBody}>
          {section.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </View>
      )}
    </Card>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case 'para':
      return <Text style={styles.para}>{block.text}</Text>;

    case 'steps':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.stepNumber}>{i + 1}</Text>
              <Text style={styles.listItemText}>{item}</Text>
            </View>
          ))}
        </View>
      );

    case 'bullets':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <View style={styles.bullet} />
              <Text style={styles.listItemText}>{item}</Text>
            </View>
          ))}
        </View>
      );

    case 'callout':
      return (
        <View style={[styles.callout, block.tone === 'warning' && styles.calloutWarning]}>
          <Icon
            name={block.tone === 'warning' ? 'alert-circle-outline' : 'information-circle-outline'}
            size="sm"
            color={block.tone === 'warning' ? Colors.seriousFg : Colors.primary}
          />
          <View style={styles.calloutText}>
            <Text
              style={[styles.calloutTitle, block.tone === 'warning' && styles.calloutTitleWarning]}
            >
              {block.title}
            </Text>
            <Text style={styles.calloutBody}>{block.text}</Text>
          </View>
        </View>
      );

    // Rendered as stacked rows rather than a real grid: a three-column table
    // at phone width either truncates every cell or scrolls sideways, and
    // neither is readable. Each row becomes its own labelled block.
    case 'table':
      return (
        <View style={styles.table}>
          {block.rows.map((row, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.tableRowTitle}>{row[0]}</Text>
              {row.slice(1).map((cell, j) => (
                <View key={j} style={styles.tableCell}>
                  {block.head[j + 1] ? (
                    <Text style={styles.tableCellLabel}>{block.head[j + 1]}</Text>
                  ) : null}
                  <Text style={styles.tableCellValue}>{cell}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, gap: Spacing.sm },

  intro: { gap: Spacing.xs },
  introTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  introBody: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 20 },

  section: { padding: 0, overflow: 'hidden' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
  },
  sectionHeaderText: { flex: 1, gap: 2 },
  sectionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  sectionSummary: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
  sectionBody: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.md,
  },

  para: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 22 },

  list: { gap: Spacing.sm },
  listItem: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  listItemText: { flex: 1, fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 22 },
  stepNumber: {
    width: 22,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
    lineHeight: 22,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: Radius.avatar,
    backgroundColor: Colors.textMuted,
    marginTop: 9,
    marginLeft: Spacing.sm,
    marginRight: Spacing.sm,
  },

  callout: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.card,
    backgroundColor: Colors.primaryLight,
  },
  calloutWarning: { backgroundColor: Colors.seriousBg },
  calloutText: { flex: 1, gap: 2 },
  calloutTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  calloutTitleWarning: { color: Colors.seriousFg },
  calloutBody: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  table: { gap: Spacing.sm },
  tableRow: {
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: Spacing.xs,
  },
  tableRowTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  tableCell: { gap: 1 },
  tableCellLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableCellValue: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  pdfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    marginTop: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    ...Shadow.md,
  },
  pdfText: { flex: 1, gap: 2 },
  pdfTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  pdfHint: { fontSize: Typography.sm, color: Colors.textSecondary },

  version: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
