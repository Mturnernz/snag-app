import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { SnagKind, SnagSeverity, SEVERITY_LABELS, KIND_LABELS, RootStackParamList } from '../types';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  supabase, getReportableSites, getLastReportedSiteId, createSnag, resolveActiveOrg,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { shouldShowHint, markHintSeen } from '../lib/firstRunHints';
import { ReportSite, resolveReportSite, cacheReportSiteId } from '../lib/reportSite';
import { useIncidentDraft } from '../context/IncidentDraftContext';
import ScreenHeader from '../components/ScreenHeader';
import PhotoPicker, { PhotoPickerHandle } from '../components/PhotoPicker';
import Chip from '../components/Chip';
import Button from '../components/Button';
import SitePicker from '../components/SitePicker';
import ConfirmDialog from '../components/ConfirmDialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SEVERITY_OPTIONS = (Object.keys(SEVERITY_LABELS) as SnagSeverity[]).map((s) => ({
  key: s,
  label: SEVERITY_LABELS[s],
}));

const KIND_OPTIONS: { key: SnagKind; label: string }[] = [
  { key: 'hazard', label: KIND_LABELS.hazard },
  { key: 'incident', label: KIND_LABELS.incident },
];

export default function ReportIncidentDetailsScreen() {
  const insets = useSafeAreaInsets();
  // Shown once, on somebody's first serious report. The onboarding carousel
  // describes the lane split before anyone has filed anything; this is the
  // moment it actually means something.
  const [hint, setHint] = useState<{ show: boolean; userId: string | null }>({ show: false, userId: null });
  const navigation = useNavigation<Nav>();
  const photoPickerRef = useRef<PhotoPickerHandle>(null);
  const { draft, setDraft, setSubmitHandler } = useIncidentDraft();

  const [description, setDescription] = useState(draft.description);
  const [kind, setKind] = useState<SnagKind>(draft.kind);
  const [severity, setSeverity] = useState<SnagSeverity>(draft.severity);
  const [photosBlocked, setPhotosBlocked] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [sites, setSites] = useState<ReportSite[]>([]);
  const [site, setSite] = useState<ReportSite | null>(
    draft.siteId && draft.siteName ? { id: draft.siteId, name: draft.siteName } : null
  );

  useEffect(() => {
    (async () => {
      const org = await resolveActiveOrg();
      setOrgId(org?.orgId ?? null);
      if (!org) return;
      const [available, lastReported] = await Promise.all([
        getReportableSites(org.orgId),
        getLastReportedSiteId(org.orgId),
      ]);
      setSites(available);
      // A site already on the draft wins — coming back from Review must not
      // silently re-pick for someone who already chose.
      const resolved = await resolveReportSite(org.orgId, available, lastReported);
      setSite((prev) => prev ?? resolved);
    })();
  }, []);

  function handleSiteChange(next: ReportSite) {
    setSite(next);
    setDraft({ siteId: next.id, siteName: next.name });
  }

  const touched = description.trim().length > 0;

  function handleBack() {
    if (touched) {
      setConfirmDiscard(true);
    } else {
      navigation.goBack();
    }
  }

  function handleNext() {
    if (!description.trim()) {
      showAlert('Description required', 'Please describe what happened.');
      return;
    }
    if (photosBlocked) {
      showAlert('Photo not ready', 'One of your photos is still uploading or failed to upload. Retry or remove it before continuing.');
      return;
    }

    setDraft({
      description: description.trim(), kind, severity, photoCount,
      siteId: site?.id ?? null, siteName: site?.name ?? null,
    });

    const chosenSiteId = site?.id ?? null;

    setSubmitHandler(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { error: 'Not authenticated' };

        const org = await resolveActiveOrg();
        if (!org) return { error: 'No organisation found' };

        // Normally the site the picker resolved; the fallback covers a report
        // submitted before the site list finished loading, which used to
        // resolve at this point anyway.
        const siteId = chosenSiteId
          ?? (await resolveReportSite(
            org.orgId,
            await getReportableSites(org.orgId),
            await getLastReportedSiteId(org.orgId)
          ))?.id
          ?? null;
        if (!siteId) return { error: 'No site found for your organisation' };

        const photoPaths = await photoPickerRef.current?.getPhotoUrls() ?? [];

        const { data, error } = await createSnag({
          kind,
          description: description.trim(),
          severity,
          photoPaths,
          latitude: null,
          longitude: null,
          siteId,
        });

        if (error) return { error: error.message };
        cacheReportSiteId(org.orgId, siteId);
        return { snagId: data?.id, reference: data?.reference };
      } catch (err: any) {
        return { error: err.message ?? 'Could not submit incident report.' };
      }
    });

    navigation.navigate('ReportIncidentReview');
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setHint({ show: await shouldShowHint('seriousReport', user.id), userId: user.id });
    });
  }, []);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Report a Serious Incident" tone="serious" onBack={handleBack} />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Use this for anything involving injury, a near-miss, or a serious health & safety hazard.
          This creates a formal record for your organisation.
        </Text>

        {/* First serious report only. The intro above says what this is for;
            this says what happens next, which is the part nobody expects the
            first time — a report that cannot simply be marked done. */}
        {hint.show && (
          <View style={styles.firstTimeHint}>
            <Text style={styles.firstTimeHintTitle}>What happens after you submit</Text>
            <Text style={styles.firstTimeHintBody}>
              Your health & safety team is notified and an investigation is opened. Someone is
              assigned to lead it, and it stays open until the first-response checklist, a witness
              statement and evidence are recorded — plus either a root cause or your
              organisation&apos;s own investigation document.
            </Text>
            <Text
              style={styles.firstTimeHintDismiss}
              onPress={() => { setHint((h) => ({ ...h, show: false })); markHintSeen('seriousReport', hint.userId); }}
            >
              Got it
            </Text>
          </View>
        )}

        {sites.length > 1 && (
          <SitePicker sites={sites} value={site} onChange={handleSiteChange} label="Site" />
        )}

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Type</Text>
          <Chip options={KIND_OPTIONS} value={kind} onChange={setKind} variant="segmented" />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>
            What happened <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe what happened, who was involved, and any immediate actions taken..."
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            maxLength={500}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Evidence</Text>
          <PhotoPicker
            ref={photoPickerRef}
            pathPrefix={orgId}
            initialUris={draft.photoUris}
            onBlockingChange={setPhotosBlocked}
            onPhotosChange={setPhotoCount}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Severity</Text>
          <Chip options={SEVERITY_OPTIONS} value={severity} onChange={setSeverity} variant="segmented" />
        </View>

        <Button
          label="Next: Review"
          variant="serious"
          onPress={handleNext}
          disabled={photosBlocked}
          fullWidth
        />
      </ScrollView>

      <ConfirmDialog
        visible={confirmDiscard}
        title="Discard this report?"
        message="What you've entered so far will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          navigation.goBack();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  firstTimeHint: {
    backgroundColor: Colors.seriousBg,
    borderRadius: Radius.card,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  firstTimeHintTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
    color: Colors.seriousFg,
  },
  firstTimeHintBody: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  firstTimeHintDismiss: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.seriousFg,
    paddingVertical: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET / 2,
  },
  intro: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    backgroundColor: Colors.seriousBg,
    borderRadius: Radius.card,
    padding: Spacing.md,
  },
  fieldGroup: {
    gap: Spacing.sm,
  },
  fieldLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  required: {
    color: Colors.danger,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  textArea: {
    minHeight: 120,
    paddingTop: Spacing.sm,
  },
});
