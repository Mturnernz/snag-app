import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  SnagKind,
  KIND_LABELS,
  ROLE_LABELS,
  RootStackParamList,
} from '../types';
import { Colors, Spacing, Typography, IconSize, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  supabase, getProfile, getReportableSites, getLastReportedSiteId, createSnag, createPublicSnag,
  getMemberships, setActiveOrg, resolveActiveOrg, Membership, getWorkGroupsWithDetail, WorkGroupDetail,
} from '../lib/supabase';
import { useReportTarget } from '../context/ReportTargetContext';
import { useIncidentDraft } from '../context/IncidentDraftContext';
import { useOfflineQueue } from '../context/OfflineQueueContext';
import { showAlert } from '../lib/alert';
import { ReportSite, resolveReportSite, cacheReportSiteId } from '../lib/reportSite';
import PhotoPicker, { PhotoPickerHandle } from '../components/PhotoPicker';
import Chip from '../components/Chip';
import Button from '../components/Button';
import Icon from '../components/Icon';
import SitePicker from '../components/SitePicker';
import ScreenEntrance from '../components/ScreenEntrance';
import TourAnchor from '../components/TourAnchor';
import { useTour } from '../context/TourContext';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Per user, per org — see loadLastGroup.
const lastGroupKey = (userId: string, orgId: string) => `snag.lastWorkGroup.${userId}.${orgId}`;

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as SnagKind[])
  .filter((k) => k === 'fixit' || k === 'improvement') // hazard/incident belong to the serious lane
  .map((k) => ({ key: k, label: KIND_LABELS[k] }));

// "Heartbeat" confirmation pulse — niggle lane only. A brief 1.0 -> 1.03 -> 1.0
// scale on mount, paired with the Success haptic already fired in doSubmit.
function HeartbeatIcon() {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSequence(
      withSpring(1.03, { damping: 8, stiffness: 200 }),
      withSpring(1, { damping: 8, stiffness: 200 })
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.successIconWrap, animatedStyle]}>
      <Icon name="checkmark" size={IconSize.xl} color={Colors.white} />
    </Animated.View>
  );
}

export default function ReportIssueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const photoPickerRef = useRef<PhotoPickerHandle>(null);
  const { target, clearTarget } = useReportTarget();
  const { setDraft } = useIncidentDraft();
  const { isOffline, enqueue } = useOfflineQueue();
  // Destructured rather than held as `tour`: the context value changes on every
  // walkthrough step, and PhotoPicker keys an effect on the callback below.
  // `completeGate` itself is stable.
  const { completeGate } = useTour();

  const handlePhotosChange = useCallback(
    (count: number) => {
      if (count > 0) completeGate('photo-added');
    },
    [completeGate],
  );

  const [photosBlocked, setPhotosBlocked] = useState(false);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<SnagKind>('fixit');
  const [isHazard, setIsHazard] = useState(false);
  const [reporterName, setReporterName] = useState('');
  const [hasProfileName, setHasProfileName] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
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
  const [sites, setSites] = useState<ReportSite[]>([]);
  const [site, setSite] = useState<ReportSite | null>(null);
  const reportSiteId = site?.id ?? null;
  // The custom group this reporter last submitted to, in this org.
  const [lastGroupId, setLastGroupId] = useState<string | null>(null);

  // Watched rather than called at the two success points, because a report
  // queued offline is still a report somebody filed — the walkthrough should
  // not hold them on "Send it" because the site has no signal.
  useEffect(() => {
    if (submitted) completeGate('snag-submitted');
  }, [submitted, completeGate]);

  // The sites this reporter can file into, and which of them the form opens
  // on: the site they last reported into here, else the first by name.
  async function loadSites(forOrgId: string | null) {
    if (!forOrgId) { setSites([]); setSite(null); return; }
    const [available, lastReported] = await Promise.all([
      getReportableSites(forOrgId),
      getLastReportedSiteId(forOrgId),
    ]);
    setSites(available);
    setSite(await resolveReportSite(forOrgId, available, lastReported));
  }

  // Work groups only apply to member (not public) submissions, and are
  // scoped to whichever org is currently active — refetched whenever that
  // changes (focus, or an explicit org switch below).
  async function loadWorkGroups(hasOrg: boolean) {
    if (!hasOrg) { setWorkGroups([]); return; }
    const groups = await getWorkGroupsWithDetail();
    setWorkGroups(groups);
  }

  // Keyed by user *and* org: work groups belong to an organisation, so the
  // last one used in one is meaningless in another, and a shared device must
  // not hand one person's default to the next.
  async function loadLastGroup(uid: string, org: string | null) {
    if (!org) { setLastGroupId(null); return; }
    setLastGroupId(await AsyncStorage.getItem(lastGroupKey(uid, org)));
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
        await loadSites(org?.orgId ?? null);
        await loadWorkGroups(Boolean(org));
        await loadLastGroup(user.id, org?.orgId ?? null);
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
        await loadSites(profile?.org_id ?? null);
        await loadWorkGroups(Boolean(profile?.org_id));
        // Work groups belong to an organisation, so the remembered one has to
        // be re-read for the org just switched to rather than carried over.
        await loadLastGroup(user.id, profile?.org_id ?? null);
      }
    } catch (err: any) {
      showAlert('Error', err.message ?? 'Could not switch organisation.');
    } finally {
      setSwitchingOrg(false);
    }
  }

  const isPublicSubmission = target !== null;
  // Which org this report goes to rides on the title row rather than sitting
  // in the form: it is context for everything below it, not a field, and the
  // card it used to be pushed the first real field off the first screen.
  // Tappable when there's a choice — a multi-org member switches, a public
  // reporter re-picks the org they're reporting to.
  const headerOrgName = isPublicSubmission ? target?.orgName ?? null : orgName;
  const canChangeHeaderOrg = isPublicSubmission || memberships.length > 1;
  // What the confirmation says the report went to. The site is named because
  // it's now a choice — and because "which site did that land on?" was
  // unanswerable from anywhere in the app before it was one.
  const destinationLabel = site && orgName ? `${orgName} · ${site.name}` : orgName;
  // Members upload photos into their org's folder; public submissions go into
  // the reporter's own user folder (each has a matching storage RLS policy).
  const photoPathPrefix = isPublicSubmission ? userId : orgId;

  // The "Submit" default group is always its own bar at the top of the
  // picker, separate from the custom-group grid below it. Custom groups are
  // further scoped to the reporter's site — a group with no sites applies
  // everywhere, one with sites only shows to reporters at one of those sites.
  const defaultGroup = workGroups.find((wg) => wg.isDefault);
  const customGroups = workGroups.filter(
    (wg) => !wg.isDefault && (wg.siteIds.length === 0 || (!!reportSiteId && wg.siteIds.includes(reportSiteId)))
  );

  // The reporter's last custom group gets its own row above the grid, rather
  // than being sorted to the front of it. People find a tile by where it sits,
  // so re-ordering the grid on every submission would cost more than the
  // repeat tap it saves. Looked up in customGroups, so a group that has since
  // been deleted, or scoped away from this site, simply doesn't appear.
  const lastGroup = lastGroupId ? customGroups.find((wg) => wg.id === lastGroupId) : undefined;

  // Capture -> [select work group] -> submit. The grid only ever appears for
  // member submissions when the org has defined any work groups; tapping a
  // tile submits immediately (no separate confirm step).
  function handleSubmit() {
    if (!description.trim()) {
      showAlert('Description required', "Tell us what's wrong.");
      return;
    }
    if (!isPublicSubmission && workGroups.length > 0) {
      setShowGroupPicker(true);
      return;
    }
    doSubmit(null);
  }

  async function doSubmit(workGroupId: string | null) {
    // Guards the work-group-picker modal's tile taps too, not just the main
    // Submit button's disabled state — a failed/still-uploading photo must
    // never be silently left out of what gets submitted.
    if (photosBlocked) {
      setShowGroupPicker(false);
      showAlert('Photo not ready', 'One of your photos is still uploading or failed to upload. Retry or remove it before submitting.');
      return;
    }
    setShowGroupPicker(false);
    setSubmitting(true);
    // Remembered on the way out rather than after a successful write: an
    // offline report is queued, not submitted, and the group the reporter
    // picked is still the one they'd want offered next time.
    if (workGroupId && userId && orgId) {
      setLastGroupId(workGroupId);
      AsyncStorage.setItem(lastGroupKey(userId, orgId), workGroupId);
    }
    try {
      // getSession() reads the locally persisted session and never hits the
      // network (unlike getUser(), which re-verifies against the server) —
      // required for the offline branch below to work at all, and just as
      // correct for the online path since nothing here needs server-side
      // re-verification.
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const user = authSession?.user;
      if (!user) throw new Error('Not authenticated');

      if (isOffline) {
        const localUris = photoPickerRef.current?.getLocalUris() ?? [];
        if (isPublicSubmission && target) {
          await enqueue({
            type: 'public',
            photoUris: localUris,
            photoPathPrefix: user.id,
            params: {
              orgId: target.orgId,
              description: description.trim(),
              isHazard,
              reporterName: reporterName.trim() || null,
            },
          });
          setSubmittedTo(target.orgName);
        } else {
          if (!orgId || !reportSiteId) {
            throw new Error("Can't save this report yet — reconnect once so your site loads, then you can report offline.");
          }
          await enqueue({
            type: 'member',
            photoUris: localUris,
            photoPathPrefix: orgId,
            params: { kind, description: description.trim(), severity: null, siteId: reportSiteId, workGroupId },
          });
          // Cached now rather than when the queue drains: this is the offline
          // stand-in for getLastReportedSiteId, which can't answer until the
          // snag actually exists.
          cacheReportSiteId(orgId, reportSiteId);
          setSubmittedTo(destinationLabel);
        }
        setReference(null);
        setQueuedOffline(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSubmitted(true);
        return;
      }

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
        if (!reportSiteId) throw new Error('No site found for your organisation');

        const { data, error } = await createSnag({
          kind,
          description: description.trim(),
          severity: null,
          photoPaths,
          latitude: null,
          longitude: null,
          siteId: reportSiteId,
          workGroupId,
        });
        if (error) throw error;
        cacheReportSiteId(orgId, reportSiteId);
        setSubmittedTo(destinationLabel);
        setReference(data?.reference ?? null);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch (err: any) {
      showAlert('Error', err.message ?? 'Could not submit snag.');
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
    setQueuedOffline(false);
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
          <HeartbeatIcon />
          <Text style={styles.successTitle}>
            {queuedOffline ? 'Saved — no signal right now' : 'Got it, thanks for flagging this.'}
          </Text>
          <Text style={styles.successMessage}>
            {queuedOffline
              ? `Your report is saved on this device and will send automatically${submittedTo ? ` to ${submittedTo}` : ''} as soon as you're back online.`
              : `${reference ?? 'Your snag'} is on its way${submittedTo ? ` to ${submittedTo}` : ''} — the team will take a look.`}
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
    <ScreenEntrance style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Report a Snag</Text>
        {headerOrgName && (
          // Sized to the header rather than to MIN_TOUCH_TARGET — hitSlop
          // takes the tap area back up to it without a 48pt pill setting the
          // height of the title row.
          <TouchableOpacity
            style={[styles.headerOrg, canChangeHeaderOrg && styles.headerOrgTappable]}
            onPress={() => {
              if (isPublicSubmission) navigation.navigate('ChooseReportOrg');
              else setShowOrgPicker(true);
            }}
            activeOpacity={canChangeHeaderOrg ? 0.7 : 1}
            disabled={!canChangeHeaderOrg || switchingOrg}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole={canChangeHeaderOrg ? 'button' : undefined}
            accessibilityLabel={
              `Reporting into ${headerOrgName}${canChangeHeaderOrg ? '. Change organisation' : ''}`
            }
          >
            <Icon
              name="business-outline"
              size="sm"
              color={canChangeHeaderOrg ? Colors.primary : Colors.textMuted}
            />
            <Text
              style={[styles.headerOrgName, canChangeHeaderOrg && styles.headerOrgNameTappable]}
              numberOfLines={1}
            >
              {headerOrgName}
            </Text>
            {switchingOrg ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : canChangeHeaderOrg ? (
              <Icon name="chevron-down" size="sm" color={Colors.primary} />
            ) : null}
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + Spacing.md },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Site — only when there's more than one to choose between. Inline,
            so the label and the site it names read as one row. */}
        {!isPublicSubmission && sites.length > 1 && (
          <TourAnchor id="report-site">
            <SitePicker sites={sites} value={site} onChange={setSite} layout="inline" />
          </TourAnchor>
        )}

        <TourAnchor id="report-photo">
          <PhotoPicker
            ref={photoPickerRef}
            pathPrefix={photoPathPrefix}
            deferUpload={isOffline}
            onBlockingChange={setPhotosBlocked}
            onPhotosChange={handlePhotosChange}
            compact
          />
        </TourAnchor>

        {/* Description — the only required field on the fast path */}
        <TourAnchor id="report-description">
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
        </TourAnchor>

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
          <TourAnchor id="report-kind">
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Type</Text>
              <Chip
                options={KIND_OPTIONS}
                value={kind}
                onChange={(next) => { setKind(next); completeGate('kind-chosen'); }}
                variant="segmented"
              />
            </View>
          </TourAnchor>
        )}

        {isOffline && (
          <View style={styles.offlineHint}>
            <Icon name="cloud-offline-outline" size="sm" color={Colors.textSecondary} />
            <Text style={styles.offlineHintText}>No connection — this will save on your device and send automatically once you're back online.</Text>
          </View>
        )}

        {/* Submit — one primary action */}
        <TourAnchor id="report-submit">
          <Button
            label="Submit Report"
            onPress={handleSubmit}
            loading={submitting}
            disabled={photosBlocked}
            fullWidth
          />
        </TourAnchor>

        {!isPublicSubmission && (
          // Serious lane — clearly clickable, but visually quieter than the primary CTA
          <TourAnchor id="report-serious">
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
          </TourAnchor>
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
                  <Text style={styles.orgOptionRole}>{ROLE_LABELS[m.role]}</Text>
                </View>
                {m.is_active && <Icon name="checkmark" size="md" color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Work group picker — capture -> select work group -> submit. Tapping
          a chip submits immediately; the "Submit" default gets its own bar. */}
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

            {/* The default group's name is the reserved literal 'Submit'
                (create_work_group seeds it and refuses the name to anyone
                else), so rendering it read as the form's own submit button
                rather than the routing choice it is. Fixed copy instead: this
                is the unrouted queue, whatever the row is called. */}
            {defaultGroup && (
              <Button
                label="Assign to the queue"
                onPress={() => doSubmit(defaultGroup.id)}
                loading={submitting}
                fullWidth
                style={styles.submitBar}
              />
            )}

            {lastGroup && (
              <Button
                label={lastGroup.name}
                variant="outline"
                icon="time-outline"
                onPress={() => { if (!submitting) doSubmit(lastGroup.id); }}
                loading={submitting}
                fullWidth
                style={styles.lastUsedBar}
              />
            )}

            {(defaultGroup || lastGroup) && customGroups.length > 0 && <Text style={styles.orText}>or</Text>}

            {customGroups.length > 0 && (
              <Chip
                options={customGroups.map((wg) => ({ key: wg.id, label: wg.name }))}
                value=""
                onChange={(id) => { if (!submitting) doSubmit(id); }}
                variant="chip"
              />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScreenEntrance>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  headerOrg: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: Spacing.xs,
    maxWidth: '50%',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.button,
  },
  headerOrgTappable: {
    backgroundColor: Colors.primaryLight,
  },
  headerOrgName: {
    flexShrink: 1,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  headerOrgNameTappable: {
    color: Colors.primary,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
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
  lastUsedBar: {
    marginTop: Spacing.sm,
  },
  orText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.md,
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
    minHeight: 88,
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
  offlineHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm,
  },
  offlineHintText: {
    flex: 1,
    fontSize: Typography.xs,
    color: Colors.textSecondary,
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
