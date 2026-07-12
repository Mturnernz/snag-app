import React, { useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  SnagKind,
  KIND_LABELS,
  RootStackParamList,
} from '../types';
import { Colors, Spacing, Typography, IconSize, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  supabase, getProfile, getDefaultSiteId, createSnag, createPublicSnag, getMemberships, setActiveOrg,
  resolveActiveOrg, Membership, getWorkGroupsWithDetail, WorkGroupDetail,
} from '../lib/supabase';
import { useReportTarget } from '../context/ReportTargetContext';
import { useIncidentDraft } from '../context/IncidentDraftContext';
import PhotoPicker, { PhotoPickerHandle } from '../components/PhotoPicker';
import Chip from '../components/Chip';
import Button from '../components/Button';
import Icon from '../components/Icon';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as SnagKind[])
  .filter((k) => k === 'fixit' || k === 'improvement') // hazard/incident belong to the serious lane
  .map((k) => ({ key: k, label: KIND_LABELS[k] }));

export default function ReportIssueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const photoPickerRef = useRef<PhotoPickerHandle>(null);
  const { target, clearTarget } = useReportTarget();
  const { setDraft } = useIncidentDraft();

  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<SnagKind>('fixit');
  const [isHazard, setIsHazard] = useState(false);
  const [reporterName, setReporterName] = useState('');
  const [hasProfileName, setHasProfileName] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [workGroups, setWorkGroups] = useState<WorkGroupDetail[]>([]);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [reportSiteId, setReportSiteId] = useState<string | null>(null);

  // Work groups only apply to member (not public) submissions, and are
  // scoped to whichever org is currently active — refetched whenever that
  // changes (focus, or an explicit org switch below).
  async function loadWorkGroups(hasOrg: boolean) {
    if (!hasOrg) { setWorkGroups([]); return; }
    const groups = await getWorkGroupsWithDetail();
    setWorkGroups(groups);
  }

  // Refetched on focus: the active org (which scopes member submissions and
  // the photo upload folder) can change via the org switcher or a QR scan.
  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);
        // Resolve the reporting org from memberships (robust; single-org users
        // default automatically) rather than the profiles read.
        const org = await resolveActiveOrg();
        setOrgId(org?.orgId ?? null);
        setOrgName(org?.orgName ?? null);
        // Deactivated orgs are hidden everywhere except the admin tab.
        setMemberships((await getMemberships()).filter((m) => m.org_active));
        const profile = await getProfile(user.id);
        setHasProfileName(Boolean(profile?.name));
        setReportSiteId(org ? await getDefaultSiteId(org.orgId) : null);
        await loadWorkGroups(Boolean(org));
      })();
    }, [])
  );

  async function handleSwitchOrg(m: Membership) {
    setShowOrgPicker(false);
    if (m.is_active) return;
    setSwitchingOrg(true);
    try {
      await setActiveOrg(m.org_id);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const profile = await getProfile(user.id);
        setOrgId(profile?.org_id ?? null);
        setOrgName(profile?.organisation?.name ?? null);
        setMemberships((await getMemberships()).filter((m) => m.org_active));
        setReportSiteId(profile?.org_id ? await getDefaultSiteId(profile.org_id) : null);
        await loadWorkGroups(Boolean(profile?.org_id));
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not switch organisation.');
    } finally {
      setSwitchingOrg(false);
    }
  }

  const isPublicSubmission = target !== null;
  // Members upload photos into their org's folder; public submissions go into
  // the reporter's own user folder (each has a matching storage RLS policy).
  const photoPathPrefix = isPublicSubmission ? userId : orgId;

  // The "Submit" default group is always its own bar at the top of the
  // picker, separate from the custom-group grid below it. Custom groups are
  // further scoped to the reporter's site — a group with no site applies
  // everywhere, one with a site only shows to reporters at that site.
  const defaultGroup = workGroups.find((wg) => wg.isDefault);
  const customGroups = workGroups.filter(
    (wg) => !wg.isDefault && (wg.siteId === null || wg.siteId === reportSiteId)
  );

  // Capture -> [select work group] -> submit. The grid only ever appears for
  // member submissions when the org has defined any work groups; tapping a
  // tile submits immediately (no separate confirm step).
  function handleSubmit() {
    if (!description.trim()) {
      Alert.alert('Description required', "Tell us what's wrong.");
      return;
    }
    if (!isPublicSubmission && workGroups.length > 0) {
      setShowGroupPicker(true);
      return;
    }
    doSubmit(null);
  }

  async function doSubmit(workGroupId: string | null) {
    setShowGroupPicker(false);
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const photoPaths = await photoPickerRef.current?.getPhotoUrls() ?? [];

      if (isPublicSubmission && target) {
        const { data, error } = await createPublicSnag({
          orgId: target.orgId,
          description: description.trim(),
          photoPaths,
          isHazard,
          reporterName: reporterName.trim() || null,
        });
        if (error) throw error;
        setSubmittedTo(target.orgName);
        setReference(data?.reference ?? null);
      } else {
        if (!orgId) throw new Error('No organisation found');

        const siteId = await getDefaultSiteId(orgId);
        if (!siteId) throw new Error('No site found for your organisation');

        const { data, error } = await createSnag({
          kind,
          description: description.trim(),
          severity: null,
          photoPaths,
          latitude: null,
          longitude: null,
          siteId,
          workGroupId,
        });
        if (error) throw error;
        setSubmittedTo(orgName);
        setReference(data?.reference ?? null);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not submit snag.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setDescription('');
    setKind('fixit');
    setIsHazard(false);
    setReporterName('');
    photoPickerRef.current?.reset();
    setSubmitted(false);
    setSubmittedTo(null);
    setReference(null);
    clearTarget();
  }

  if (submitted) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Report a Snag</Text>
        </View>
        <View style={styles.successContainer}>
          <View style={styles.successIconWrap}>
            <Icon name="checkmark" size={IconSize.xl} color={Colors.white} />
          </View>
          <Text style={styles.successTitle}>Snag reported!</Text>
          <Text style={styles.successMessage}>
            {reference ?? 'Your snag'} has been submitted
            {submittedTo ? ` to ${submittedTo}` : ''} and the team will be notified.
          </Text>
          <Button label="Report Another Snag" onPress={resetForm} fullWidth />
        </View>
      </View>
    );
  }

  // No org and no target yet: a public reporter's entry point.
  if (!orgId && !isPublicSubmission) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Report a Snag</Text>
        </View>
        <View style={styles.successContainer}>
          <Icon name="business-outline" size={IconSize.xxl} color={Colors.textSecondary} />
          <Text style={styles.successTitle}>Who is this report for?</Text>
          <Text style={styles.successMessage}>
            Pick the organisation you want to send your report to.
          </Text>
          <Button
            label="Choose an Organisation"
            onPress={() => navigation.navigate('ChooseReportOrg')}
            fullWidth
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Report a Snag</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Cross-org submissions always show which org will receive this. */}
        {isPublicSubmission && target && (
          <View style={styles.targetPill}>
            <Icon name="business-outline" size="sm" color={Colors.primary} />
            <Text style={styles.targetPillText}>
              Reporting to: <Text style={styles.targetPillOrg}>{target.orgName}</Text>
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('ChooseReportOrg')} hitSlop={8}>
              <Text style={styles.targetPillChange}>Change</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Member submissions show which org they're reporting into. With more
            than one membership it's a tappable switcher; otherwise a label. */}
        {!isPublicSubmission && orgName && (
          <TouchableOpacity
            style={styles.orgPill}
            onPress={() => memberships.length > 1 && setShowOrgPicker(true)}
            activeOpacity={memberships.length > 1 ? 0.7 : 1}
            disabled={memberships.length <= 1 || switchingOrg}
          >
            <Icon name="business-outline" size="sm" color={Colors.primary} />
            <View style={styles.orgPillText}>
              <Text style={styles.orgPillLabel}>Reporting into</Text>
              <Text style={styles.orgPillOrg} numberOfLines={1}>{orgName}</Text>
            </View>
            {switchingOrg ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : memberships.length > 1 ? (
              <View style={styles.orgPillChangeRow}>
                <Text style={styles.orgPillChange}>Change</Text>
                <Icon name="chevron-down" size="sm" color={Colors.primary} />
              </View>
            ) : null}
          </TouchableOpacity>
        )}

        <PhotoPicker ref={photoPickerRef} pathPrefix={photoPathPrefix} onUploadingChange={setIsPhotoUploading} />

        {/* Description — the only required field on the fast path */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>
              What's wrong? <Text style={styles.required}>*</Text>
            </Text>
            <Text style={[styles.charCount, description.length > 270 && styles.charCountWarn]}>
              {description.length} / 300
            </Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="e.g. Broken fire exit door in the main warehouse"
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={300}
          />
        </View>

        {isPublicSubmission ? (
          <>
            {!hasProfileName && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Your name (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="So the team knows who reported this"
                  placeholderTextColor={Colors.textMuted}
                  value={reporterName}
                  onChangeText={setReporterName}
                />
              </View>
            )}

            {/* Public reporters don't pick internal categories — just a
                safety-hazard flag the org's staff can triage. */}
            <View style={styles.hazardRow}>
              <View style={styles.hazardText}>
                <Text style={styles.fieldLabel}>This is a safety hazard</Text>
                <Text style={styles.hazardHint}>Flags the report for urgent attention</Text>
              </View>
              <Switch
                value={isHazard}
                onValueChange={setIsHazard}
                trackColor={{ false: Colors.border, true: Colors.seriousBg }}
                thumbColor={isHazard ? Colors.serious : Colors.surface}
              />
            </View>
          </>
        ) : (
          // Type — members only
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Type</Text>
            <Chip options={KIND_OPTIONS} value={kind} onChange={setKind} variant="segmented" />
          </View>
        )}

        {/* Submit — one primary action */}
        <Button
          label="Submit Report"
          onPress={handleSubmit}
          loading={submitting}
          disabled={isPhotoUploading}
          fullWidth
        />

        {!isPublicSubmission && (
          // Serious lane — clearly clickable, but visually quieter than the primary CTA
          <Button
            label="Report a Serious Incident"
            variant="seriousOutline"
            icon="warning-outline"
            onPress={() => {
              setDraft({
                description,
                photoUris: photoPickerRef.current?.getLocalUris() ?? [],
              });
              navigation.navigate('ReportIncidentDetails');
            }}
            fullWidth
          />
        )}
      </ScrollView>

      {/* Org switcher — only reachable for multi-org members */}
      <Modal
        visible={showOrgPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOrgPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowOrgPicker(false)}
        >
          <TouchableOpacity style={styles.modalSheet} activeOpacity={1}>
            <Text style={styles.modalTitle}>Report into</Text>
            <Text style={styles.modalHint}>Choose which organisation this snag goes to.</Text>
            {memberships.map((m) => (
              <TouchableOpacity
                key={m.org_id}
                style={styles.orgOption}
                onPress={() => handleSwitchOrg(m)}
                activeOpacity={0.7}
              >
                <View style={styles.orgOptionText}>
                  <Text style={styles.orgOptionName}>{m.org_name}</Text>
                  <Text style={styles.orgOptionRole}>{m.role.replace('_', ' ')}</Text>
                </View>
                {m.is_active && <Icon name="checkmark" size="md" color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Work group picker — capture -> select work group -> submit. Tapping
          a tile submits immediately, including the "Submit" default tile. */}
      <Modal
        visible={showGroupPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGroupPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowGroupPicker(false)}
        >
          <TouchableOpacity style={styles.modalSheet} activeOpacity={1}>
            <Text style={styles.modalTitle}>Select a work group</Text>
            <Text style={styles.modalHint}>Which team should handle this?</Text>

            {defaultGroup && (
              <Button
                label={defaultGroup.name}
                onPress={() => doSubmit(defaultGroup.id)}
                loading={submitting}
                fullWidth
                style={styles.submitBar}
              />
            )}

            {defaultGroup && customGroups.length > 0 && <Text style={styles.orText}>or</Text>}

            {customGroups.length > 0 && (
              <ScrollView contentContainerStyle={styles.groupGrid}>
                {customGroups.map((wg) => (
                  <TouchableOpacity
                    key={wg.id}
                    style={[styles.groupTile, { backgroundColor: wg.color ?? Colors.textSecondary }]}
                    onPress={() => doSubmit(wg.id)}
                    activeOpacity={0.85}
                    disabled={submitting}
                  >
                    <View style={styles.groupTileOverlay} />
                    <Text style={styles.groupTileText} numberOfLines={2}>{wg.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },

  targetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  targetPillText: {
    flex: 1,
    fontSize: Typography.sm,
    color: Colors.textPrimary,
  },
  targetPillOrg: {
    fontWeight: Typography.bold,
    color: Colors.primary,
  },
  targetPillChange: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },

  orgPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  orgPillText: {
    flex: 1,
    gap: 1,
    alignItems: 'center',
  },
  orgPillLabel: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  orgPillOrg: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  orgPillChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  orgPillChange: {
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
  orgOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET,
  },
  orgOptionText: {
    flex: 1,
    gap: 2,
  },
  orgOptionName: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  orgOptionRole: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    textTransform: 'capitalize',
  },

  submitBar: {
    marginTop: Spacing.sm,
  },
  orText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  groupGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  groupTile: {
    flexBasis: '48%',
    flexGrow: 1,
    aspectRatio: 1.3,
    borderRadius: Radius.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  groupTileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  groupTileText: {
    fontSize: Typography.base,
    fontWeight: Typography.bold,
    color: Colors.white,
    textAlign: 'center',
  },

  fieldGroup: {
    gap: Spacing.sm,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  required: {
    color: Colors.danger,
  },
  charCount: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },
  charCountWarn: {
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
    minHeight: 100,
    paddingTop: Spacing.sm,
  },

  hazardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  hazardText: {
    flex: 1,
    gap: 2,
  },
  hazardHint: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },

  // Success confirmation
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  successTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
