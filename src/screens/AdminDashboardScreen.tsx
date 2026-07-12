import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Organisation, Profile, SnagStatus, STATUS_LABELS, UserRole, RootStackParamList } from '../types';
import {
  supabase, getOrgStats, OrgStats, getMemberships, setOrganisationActive, Membership,
  getOrgMembers, getOrgSites, createSite, getWorkGroupsWithDetail, createWorkGroup, updateWorkGroup,
  assignWorkGroupSupervisor, removeWorkGroupSupervisor, uploadWorkGroupImage, getWorkGroupImageUrl, WorkGroupDetail,
} from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET, WorkGroupPalette } from '../constants/theme';
import Card from '../components/Card';
import Button from '../components/Button';
import Chip from '../components/Chip';
import Icon from '../components/Icon';
import OrgSwitcherHeader from '../components/OrgSwitcherHeader';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// The three snag states worth surfacing at a glance on the dashboard.
const HEADLINE_STATUSES: SnagStatus[] = ['flagged', 'in_progress', 'resolved'];
const STATUS_COLOR: Record<SnagStatus, string> = {
  flagged: Colors.status.flagged,
  in_progress: Colors.status.inProgress,
  resolved: Colors.status.resolved,
  rca_pending: Colors.status.rcaPending,
};

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [ownedOrgs, setOwnedOrgs] = useState<Membership[]>([]);
  const [togglingOrgId, setTogglingOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Work groups
  const [workGroups, setWorkGroups] = useState<WorkGroupDetail[]>([]);
  const [wgImageUrls, setWgImageUrls] = useState<Record<string, string>>({});
  const [supervisors, setSupervisors] = useState<Profile[]>([]);
  const [managingGroup, setManagingGroup] = useState<WorkGroupDetail | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState<string>(WorkGroupPalette[0]);
  const [newGroupImageUri, setNewGroupImageUri] = useState<string | null>(null);
  const [newGroupSiteId, setNewGroupSiteId] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Sites — for scoping a work group to one site, or leaving it for all.
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [showNewSiteInput, setShowNewSiteInput] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [creatingSite, setCreatingSite] = useState(false);

  const canManageWorkGroups = role === 'officer_admin' || role === 'supervisor';

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setCurrentUserId(user.id);

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations!profiles_org_id_fkey(id, name, industry, plan_tier, join_code, is_public, public_intake_site_id, created_at, is_active)')
      .eq('id', user.id)
      .single();

    let profileRole: UserRole | null = null;
    if (data) {
      const profile = data as unknown as Profile;
      setOrg((profile.organisation as Organisation | undefined) ?? null);
      setRole(profile.role);
      profileRole = profile.role;
      setIsAdmin(profile.role === 'officer_admin');
      if (profile.org_id) setStats(await getOrgStats(profile.org_id));
    }

    // Every org this user administers, active or not — the only place
    // deactivated orgs remain visible/manageable.
    const memberships = await getMemberships();
    setOwnedOrgs(memberships.filter((m) => m.role === 'officer_admin'));

    if (profileRole === 'officer_admin' || profileRole === 'supervisor') {
      if (data?.org_id) getOrgSites(data.org_id).then(setSites);
      const groups = await getWorkGroupsWithDetail();
      setWorkGroups(groups);
      const withImages = groups.filter((g) => g.imagePath);
      if (withImages.length > 0) {
        const entries = await Promise.all(
          withImages.map(async (g) => [g.id, await getWorkGroupImageUrl(g.imagePath!)] as const)
        );
        setWgImageUrls(Object.fromEntries(entries.filter((e): e is [string, string] => Boolean(e[1]))));
      } else {
        setWgImageUrls({});
      }
      getOrgMembers().then((members) => setSupervisors(members.filter((m) => m.role === 'supervisor')));
    }

    setLoading(false);
  }, []);

  function handleToggleActive(m: Membership) {
    const deactivating = m.org_active;
    Alert.alert(
      deactivating ? 'Deactivate organisation?' : 'Reactivate organisation?',
      deactivating
        ? `${m.org_name} will be hidden from every member's org switcher, and they won't be able to view or submit snags there until you reactivate it.`
        : `${m.org_name} will be visible again and members will be able to switch to it, view, and submit snags.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: deactivating ? 'Deactivate' : 'Reactivate',
          style: deactivating ? 'destructive' : 'default',
          onPress: async () => {
            setTogglingOrgId(m.org_id);
            const { error } = await setOrganisationActive(m.org_id, !deactivating);
            setTogglingOrgId(null);
            if (error) {
              Alert.alert('Error', error.message ?? 'Could not update organisation status');
            } else {
              await load();
            }
          },
        },
      ]
    );
  }

  async function pickGroupImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, exif: false });
    if (result.canceled) return;
    const compressed = await ImageManipulator.manipulateAsync(
      result.assets[0].uri,
      [{ resize: { width: 400 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    setNewGroupImageUri(compressed.uri);
  }

  // Called after any change to a work group so both the list and (if open)
  // the "Manage" modal's snapshot stay in sync — mirrors ManageOrganisation-
  // Screen's refreshSites, using the freshly-fetched array directly rather
  // than reading back from React state to avoid a stale-closure race.
  async function refreshWorkGroups() {
    const groups = await getWorkGroupsWithDetail();
    setWorkGroups(groups);
    setManagingGroup((prev) => (prev ? groups.find((g) => g.id === prev.id) ?? null : null));
    const withImages = groups.filter((g) => g.imagePath);
    if (withImages.length > 0) {
      const entries = await Promise.all(
        withImages.map(async (g) => [g.id, await getWorkGroupImageUrl(g.imagePath!)] as const)
      );
      setWgImageUrls(Object.fromEntries(entries.filter((e): e is [string, string] => Boolean(e[1]))));
    } else {
      setWgImageUrls({});
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim() || !org) return;
    setCreatingGroup(true);
    let imagePath: string | null = null;
    if (newGroupImageUri) {
      const fileName = `${org.id}/${Date.now()}.jpg`;
      imagePath = await uploadWorkGroupImage(newGroupImageUri, fileName);
    }
    const { error } = await createWorkGroup(
      newGroupName.trim(), imagePath ? null : newGroupColor, imagePath, newGroupSiteId || null
    );
    setCreatingGroup(false);
    if (!error) {
      setNewGroupName('');
      setNewGroupColor(WorkGroupPalette[0]);
      setNewGroupImageUri(null);
      setNewGroupSiteId('');
      await load();
    } else {
      Alert.alert('Error', error.message ?? 'Could not create work group');
    }
  }

  async function handleCreateSiteInline() {
    if (!newSiteName.trim()) return;
    setCreatingSite(true);
    const { error } = await createSite(newSiteName.trim());
    setCreatingSite(false);
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not create site');
      return;
    }
    setNewSiteName('');
    setShowNewSiteInput(false);
    if (org) {
      const fresh = await getOrgSites(org.id);
      setSites(fresh);
      const created = fresh.find((s) => !sites.some((existing) => existing.id === s.id));
      if (created) setNewGroupSiteId(created.id);
    }
  }

  // Reload on focus — the org this dashboard reflects is the active org, which
  // may have changed via the Profile switcher or a QR scan.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <OrgSwitcherHeader title="Admin" role={role} orgName={org?.name ?? null} onSwitched={load} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Snapshot */}
        <View style={styles.statRow}>
          <Card variant="elevated" style={styles.statTile}>
            <Text style={styles.statValue}>{stats?.totalSnags ?? 0}</Text>
            <Text style={styles.statLabel}>Total snags</Text>
          </Card>
          <Card variant="elevated" style={styles.statTile}>
            <Text style={styles.statValue}>{stats?.totalMembers ?? 0}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </Card>
        </View>

        <Card variant="elevated" style={styles.breakdownCard}>
          <Text style={styles.sectionLabel}>BY STATUS</Text>
          {HEADLINE_STATUSES.map((s) => (
            <View key={s} style={styles.breakdownRow}>
              <View style={styles.breakdownLeft}>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[s] }]} />
                <Text style={styles.breakdownLabel}>{STATUS_LABELS[s]}</Text>
              </View>
              <Text style={styles.breakdownValue}>{stats?.byStatus[s] ?? 0}</Text>
            </View>
          ))}
        </Card>

        {/* Actions */}
        {isAdmin && (
          <Button
            label="Manage Organisation"
            icon="business-outline"
            onPress={() => navigation.navigate('ManageOrganisation')}
            fullWidth
          />
        )}
        <Button
          label="View Reports"
          variant="outline"
          icon="bar-chart-outline"
          onPress={() => navigation.navigate('Reports')}
          fullWidth
        />

        {!isAdmin && (
          <View style={styles.noteRow}>
            <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
            <Text style={styles.noteText}>
              Organisation settings, sites and members are managed by an officer admin.
            </Text>
          </View>
        )}

        {/* Work groups — supervisors can create groups; only an admin can
            assign supervisors to one. */}
        {canManageWorkGroups && (
          <Card variant="elevated" style={styles.wgCard}>
            <Text style={styles.sectionLabel}>WORK GROUPS</Text>
            <Text style={styles.hint}>
              Route snags to a team (e.g. Vehicles, Kitchen, Facilities) after they're submitted. A "Submit" default
              group appears automatically once you add your first one.
            </Text>

            {workGroups.filter((g) => !g.isDefault).map((wg) => (
              <View key={wg.id} style={styles.wgRow}>
                {wg.imagePath && wgImageUrls[wg.id] ? (
                  <Image source={{ uri: wgImageUrls[wg.id] }} style={styles.wgSwatch} contentFit="cover" />
                ) : (
                  <View style={[styles.wgSwatch, { backgroundColor: wg.color ?? Colors.textMuted }]} />
                )}
                <View style={styles.wgInfo}>
                  <Text style={styles.wgName}>{wg.name}</Text>
                  <Text style={styles.wgMeta}>
                    {wg.siteName ?? 'All sites'} · {wg.supervisorIds.length} supervisor{wg.supervisorIds.length !== 1 ? 's' : ''}
                  </Text>
                </View>
                <Button label="Manage" variant="outline" onPress={() => setManagingGroup(wg)} />
              </View>
            ))}

            {workGroups.filter((g) => !g.isDefault).length === 0 && (
              <Text style={styles.hintMuted}>No work groups yet — add one below.</Text>
            )}

            <Text style={styles.fieldLabel}>Add a work group</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Vehicles"
              placeholderTextColor={Colors.textMuted}
              value={newGroupName}
              onChangeText={setNewGroupName}
            />

            <Text style={styles.fieldLabel}>Site</Text>
            <Chip
              options={[{ key: '', label: 'All sites' }, ...sites.map((s) => ({ key: s.id, label: s.name }))]}
              value={newGroupSiteId}
              onChange={setNewGroupSiteId}
              variant="segmented"
            />
            {isAdmin && (
              showNewSiteInput ? (
                <View style={styles.rowButtons}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    placeholder="New site name"
                    placeholderTextColor={Colors.textMuted}
                    value={newSiteName}
                    onChangeText={setNewSiteName}
                  />
                  <Button label="Add" onPress={handleCreateSiteInline} loading={creatingSite} />
                </View>
              ) : (
                <TouchableOpacity onPress={() => setShowNewSiteInput(true)}>
                  <Text style={styles.uploadImageText}>+ New site</Text>
                </TouchableOpacity>
              )
            )}

            {newGroupImageUri ? (
              <View style={styles.imagePreviewRow}>
                <Image source={{ uri: newGroupImageUri }} style={styles.imagePreview} contentFit="cover" />
                <TouchableOpacity onPress={() => setNewGroupImageUri(null)}>
                  <Text style={styles.removeImageText}>Remove image</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Colour</Text>
                <View style={styles.paletteRow}>
                  {WorkGroupPalette.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.swatchOption, { backgroundColor: c }, newGroupColor === c && styles.swatchOptionActive]}
                      onPress={() => setNewGroupColor(c)}
                    />
                  ))}
                </View>
                <TouchableOpacity onPress={pickGroupImage}>
                  <Text style={styles.uploadImageText}>Or upload an image</Text>
                </TouchableOpacity>
              </>
            )}

            <Button
              label="Add Work Group"
              onPress={handleCreateGroup}
              loading={creatingGroup}
              disabled={!newGroupName.trim()}
              fullWidth
              style={styles.topGap}
            />
          </Card>
        )}

        {/* Owned organisations, active or not — the only place a deactivated
            org stays visible and manageable. */}
        {ownedOrgs.length > 0 && (
          <Card variant="elevated" style={styles.ownedCard}>
            <Text style={styles.sectionLabel}>YOUR ORGANISATIONS</Text>
            {ownedOrgs.map((m) => (
              <View key={m.org_id} style={styles.ownedRow}>
                <View style={styles.ownedRowText}>
                  <View style={styles.ownedRowNameRow}>
                    <Text style={styles.ownedRowName}>{m.org_name}</Text>
                    {m.org_id === org?.id && <Text style={styles.ownedRowCurrent}>Current</Text>}
                  </View>
                  <View style={[styles.statusPill, m.org_active ? styles.statusPillActive : styles.statusPillInactive]}>
                    <Text style={[styles.statusPillText, m.org_active ? styles.statusPillTextActive : styles.statusPillTextInactive]}>
                      {m.org_active ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>
                {togglingOrgId === m.org_id ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Button
                    label={m.org_active ? 'Deactivate' : 'Reactivate'}
                    variant={m.org_active ? 'dangerOutline' : 'outline'}
                    onPress={() => handleToggleActive(m)}
                  />
                )}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      <WorkGroupSupervisorModal
        group={managingGroup}
        supervisors={supervisors}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        orgId={org?.id ?? null}
        sites={sites}
        onSitesChanged={setSites}
        imageUrl={managingGroup ? wgImageUrls[managingGroup.id] : undefined}
        onClose={() => setManagingGroup(null)}
        onChanged={refreshWorkGroups}
      />
    </View>
  );
}

// ── Work group supervisor modal ──────────────────────────────────────────────
// Lists every org supervisor with an assign/unassign toggle. An admin can
// toggle anyone; a supervisor can only self-assign/self-unassign.
function WorkGroupSupervisorModal({
  group,
  supervisors,
  isAdmin,
  currentUserId,
  orgId,
  sites,
  onSitesChanged,
  imageUrl,
  onClose,
  onChanged,
}: {
  group: WorkGroupDetail | null;
  supervisors: Profile[];
  isAdmin: boolean;
  currentUserId: string | null;
  orgId: string | null;
  sites: { id: string; name: string }[];
  onSitesChanged: (sites: { id: string; name: string }[]) => void;
  imageUrl?: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);

  // Edit fields — undefined image means "unchanged", null means "explicitly
  // removed" (falls back to colour), a string is a newly-picked local URI
  // pending upload on save.
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<string>(WorkGroupPalette[0]);
  const [editImageUri, setEditImageUri] = useState<string | null | undefined>(undefined);
  const [editSiteId, setEditSiteId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [showNewSiteInput, setShowNewSiteInput] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [creatingSite, setCreatingSite] = useState(false);

  useEffect(() => {
    if (!group) return;
    setEditName(group.name);
    setEditColor(group.color ?? WorkGroupPalette[0]);
    setEditImageUri(undefined);
    setEditSiteId(group.siteId ?? '');
    setShowNewSiteInput(false);
    setNewSiteName('');
  }, [group?.id]);

  if (!group) return null;

  const hasImage = editImageUri === undefined ? Boolean(group.imagePath) : Boolean(editImageUri);
  const previewUri = editImageUri === undefined ? imageUrl : editImageUri ?? undefined;

  async function pickEditImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, exif: false });
    if (result.canceled) return;
    const compressed = await ImageManipulator.manipulateAsync(
      result.assets[0].uri,
      [{ resize: { width: 400 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    setEditImageUri(compressed.uri);
  }

  async function handleSaveEdit() {
    if (!group || !editName.trim() || !orgId) return;
    setSavingEdit(true);
    let imagePath: string | null;
    if (editImageUri === undefined) {
      imagePath = group.imagePath;
    } else if (editImageUri === null) {
      imagePath = null;
    } else {
      const fileName = `${orgId}/${Date.now()}.jpg`;
      imagePath = await uploadWorkGroupImage(editImageUri, fileName);
    }
    const { error } = await updateWorkGroup(
      group.id, editName.trim(), imagePath ? null : editColor, imagePath, editSiteId || null
    );
    setSavingEdit(false);
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not update work group');
    } else {
      setEditImageUri(undefined);
      await onChanged();
    }
  }

  async function handleCreateSiteInline() {
    if (!newSiteName.trim() || !orgId) return;
    setCreatingSite(true);
    const { error } = await createSite(newSiteName.trim());
    setCreatingSite(false);
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not create site');
      return;
    }
    setNewSiteName('');
    setShowNewSiteInput(false);
    const fresh = await getOrgSites(orgId);
    const created = fresh.find((s) => !sites.some((existing) => existing.id === s.id));
    onSitesChanged(fresh);
    if (created) setEditSiteId(created.id);
  }

  // A supervisor can only self-assign/self-unassign; an admin can toggle anyone.
  function canToggle(userId: string) {
    return isAdmin || userId === currentUserId;
  }

  async function toggle(userId: string, active: boolean) {
    if (!group || !canToggle(userId)) return;
    setBusy(userId);
    const { error } = active
      ? await removeWorkGroupSupervisor(group.id, userId)
      : await assignWorkGroupSupervisor(group.id, userId);
    if (error) Alert.alert('Error', error.message ?? 'Could not update this work group');
    await onChanged();
    setBusy(null);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>{group.name}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size="md" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll}>
            <Text style={styles.sectionLabel}>DETAILS</Text>
            <TextInput
              style={styles.input}
              placeholder="Work group name"
              placeholderTextColor={Colors.textMuted}
              value={editName}
              onChangeText={setEditName}
            />

            <Text style={styles.fieldLabel}>Site</Text>
            <Chip
              options={[{ key: '', label: 'All sites' }, ...sites.map((s) => ({ key: s.id, label: s.name }))]}
              value={editSiteId}
              onChange={setEditSiteId}
              variant="segmented"
            />
            {isAdmin && (
              showNewSiteInput ? (
                <View style={styles.rowButtons}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    placeholder="New site name"
                    placeholderTextColor={Colors.textMuted}
                    value={newSiteName}
                    onChangeText={setNewSiteName}
                  />
                  <Button label="Add" onPress={handleCreateSiteInline} loading={creatingSite} />
                </View>
              ) : (
                <TouchableOpacity onPress={() => setShowNewSiteInput(true)}>
                  <Text style={styles.uploadImageText}>+ New site</Text>
                </TouchableOpacity>
              )
            )}

            {hasImage ? (
              <View style={styles.imagePreviewRow}>
                {previewUri && <Image source={{ uri: previewUri }} style={styles.imagePreview} contentFit="cover" />}
                <TouchableOpacity onPress={() => setEditImageUri(null)}>
                  <Text style={styles.removeImageText}>Remove image</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Colour</Text>
                <View style={styles.paletteRow}>
                  {WorkGroupPalette.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.swatchOption, { backgroundColor: c }, editColor === c && styles.swatchOptionActive]}
                      onPress={() => setEditColor(c)}
                    />
                  ))}
                </View>
                <TouchableOpacity onPress={pickEditImage}>
                  <Text style={styles.uploadImageText}>Or upload an image</Text>
                </TouchableOpacity>
              </>
            )}

            <Button
              label="Save Changes"
              onPress={handleSaveEdit}
              loading={savingEdit}
              disabled={!editName.trim()}
              fullWidth
              style={styles.topGap}
            />

            <View style={styles.divider} />

            <Text style={styles.sectionLabel}>SUPERVISORS</Text>
            <Text style={styles.modalHint}>
              {isAdmin
                ? 'Snags routed here auto-assign to the supervisor if exactly one is set.'
                : 'You can assign or unassign yourself. Only an admin can change other supervisors.'}
            </Text>
            {supervisors.map((s) => {
              const active = group.supervisorIds.includes(s.id);
              const enabled = canToggle(s.id);
              return (
                <View key={s.id} style={styles.assignRow}>
                  <Text style={styles.assignName} numberOfLines={1}>{s.name || s.email}</Text>
                  <TouchableOpacity
                    style={[styles.toggle, active && styles.toggleActive, !enabled && styles.toggleDisabled]}
                    onPress={() => toggle(s.id, active)}
                    disabled={!enabled || busy === s.id}
                    activeOpacity={0.7}
                  >
                    {busy === s.id ? (
                      <ActivityIndicator size="small" color={active ? Colors.white : Colors.primary} />
                    ) : (
                      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
                        {active ? 'Supervisor' : 'Assign'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
            {supervisors.length === 0 && (
              <Text style={styles.hintMuted}>No supervisors in this organisation yet.</Text>
            )}
          </ScrollView>

          <Button label="Done" onPress={onClose} fullWidth style={styles.topGap} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },

  scroll: { padding: Spacing.lg, gap: Spacing.lg },

  statRow: { flexDirection: 'row', gap: Spacing.md },
  statTile: { flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  statValue: { fontSize: Typography.xxxl, fontWeight: Typography.bold, color: Colors.textPrimary },
  statLabel: { fontSize: Typography.sm, color: Colors.textSecondary },

  breakdownCard: { gap: Spacing.sm },
  sectionLabel: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.8 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.xs },
  breakdownLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  breakdownLabel: { fontSize: Typography.base, color: Colors.textPrimary },
  breakdownValue: { fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.textPrimary },

  noteRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', paddingHorizontal: Spacing.xs },
  noteText: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 18 },

  ownedCard: { gap: Spacing.md },
  ownedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  ownedRowText: { flex: 1, gap: Spacing.xs },
  ownedRowNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ownedRowName: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },
  ownedRowCurrent: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  statusPillActive: { backgroundColor: Colors.successBg },
  statusPillInactive: { backgroundColor: Colors.priority.mediumBg },
  statusPillText: { fontSize: Typography.xs, fontWeight: Typography.semibold },
  statusPillTextActive: { color: Colors.success },
  statusPillTextInactive: { color: Colors.priority.medium },

  // Work groups
  wgCard: { gap: Spacing.sm },
  hint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
  hintMuted: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
  fieldLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary, marginTop: Spacing.xs },
  topGap: { marginTop: Spacing.sm },
  rowButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex1: { flex: 1 },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  wgRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  wgSwatch: { width: 40, height: 40, borderRadius: Radius.button },
  wgInfo: { flex: 1, gap: 2 },
  wgName: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },
  wgMeta: { fontSize: Typography.xs, color: Colors.textMuted },
  paletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  swatchOption: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  swatchOptionActive: { borderColor: Colors.textPrimary },
  uploadImageText: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.primary, marginTop: Spacing.xs },
  imagePreviewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  imagePreview: { width: 60, height: 60, borderRadius: Radius.button, backgroundColor: Colors.background },
  removeImageText: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.danger },

  // Work group supervisor modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    padding: Spacing.lg, gap: Spacing.sm, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { flex: 1, fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  modalHint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
  modalScroll: { marginTop: Spacing.sm },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  assignRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  assignName: { flex: 1, fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },
  toggle: {
    minWidth: 84, height: 34, paddingHorizontal: Spacing.sm, borderRadius: Radius.button,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleDisabled: { opacity: 0.5 },
  toggleText: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.white },
});
